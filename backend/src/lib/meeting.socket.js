/**
 * meeting.socket.js
 *
 * Control-plane + chat socket handlers for meetings.
 * Registered inside the single existing io.on("connection") in server.js.
 *
 * Identity is ALWAYS taken from socket.authUser (set by the JWT handshake
 * middleware). Payload-supplied user ids are never trusted. Raw audio/video
 * never flows through Socket.IO — only lifecycle + chat.
 */
import Collab from "../models/Collab.js";
import Meeting from "../models/Meeting.js";
import MeetingMessage from "../models/MeetingMessage.js";

const oid = (v) => String(v && (v._id || v));

// Simple per-socket chat rate limiter: max MSG_LIMIT messages per WINDOW ms.
const MSG_LIMIT = 8;
const MSG_WINDOW_MS = 6000;

export function registerMeetingSocketHandlers(io, socket) {
  const authed = () => socket.authUser && socket.authUser._id;

  // ── Join/leave the room notification channel ───────────────────────────────
  socket.on("meeting:subscribe", async ({ roomId } = {}, ack) => {
    try {
      if (!authed()) return ack?.({ ok: false, error: "unauthorized" });
      const collab = await Collab.findById(roomId);
      const member = collab && (oid(collab.requester) === socket.authUser._id ||
        collab.participants.map(oid).includes(socket.authUser._id));
      if (!member) {
        return ack?.({ ok: false, error: "not_member" });
      }
      socket.join(`collab:${roomId}`);
      return ack?.({ ok: true });
    } catch (err) {
      console.error("[meeting.socket] subscribe:", err.message);
      return ack?.({ ok: false, error: "server_error" });
    }
  });

  socket.on("meeting:unsubscribe", ({ roomId } = {}) => {
    if (roomId) socket.leave(`collab:${roomId}`);
  });

  // ── Real-time meeting chat ─────────────────────────────────────────────────
  socket.on("meeting:chat-message", async (payload = {}, ack) => {
    try {
      if (!authed()) return ack?.({ ok: false, error: "unauthorized" });

      const { meetingId, text } = payload;
      if (!meetingId) return ack?.({ ok: false, error: "missing_meeting" });

      // Validate + normalize the message body.
      const clean = typeof text === "string" ? text.trim() : "";
      if (!clean) return ack?.({ ok: false, error: "empty_message" });
      if (clean.length > 2000) return ack?.({ ok: false, error: "message_too_long" });

      // Rate limit.
      const now = Date.now();
      socket._chatTimes = (socket._chatTimes || []).filter((t) => now - t < MSG_WINDOW_MS);
      if (socket._chatTimes.length >= MSG_LIMIT) {
        return ack?.({ ok: false, error: "rate_limited" });
      }
      socket._chatTimes.push(now);

      // Load meeting and verify membership + admission server-side.
      const meeting = await Meeting.findById(meetingId);
      if (!meeting || meeting.status !== "active") {
        return ack?.({ ok: false, error: "meeting_inactive" });
      }

      const collab = await Collab.findById(meeting.roomId);
      const isMember = collab && (oid(collab.requester) === socket.authUser._id ||
        collab.participants.map(oid).includes(socket.authUser._id));
      if (!isMember) return ack?.({ ok: false, error: "not_member" });

      const isHost = oid(meeting.host) === socket.authUser._id;
      const p = meeting.participants.find((x) => oid(x.user) === socket.authUser._id);
      if (!isHost && (!p || p.state !== "admitted")) {
        return ack?.({ ok: false, error: "not_admitted" });
      }

      // Persist — sender identity derived from the authenticated socket.
      const saved = await MeetingMessage.create({
        meeting: meeting._id,
        sender: socket.authUser._id,
        senderName: socket.authUser.fullName,
        senderAvatar: socket.authUser.profilePic || "",
        text: clean,
      });

      const message = {
        id: saved._id.toString(),
        meetingId: meetingId,
        sender: socket.authUser._id,
        senderName: socket.authUser.fullName,
        senderAvatar: socket.authUser.profilePic || "",
        text: clean,
        createdAt: saved.createdAt,
        mine: false,
      };

      // Broadcast to everyone subscribed to the room (participants only).
      io.to(`collab:${oid(meeting.roomId)}`).emit("meeting:chat-message", message);

      // Echo to the sender with a flag so the client can dedupe / mark as "mine".
      if (socket.id !== undefined) {
        io.to(socket.id).emit("meeting:chat-message", { ...message, mine: true });
      }

      return ack?.({ ok: true, message });
    } catch (err) {
      console.error("[meeting.socket] chat:", err.message);
      return ack?.({ ok: false, error: "server_error" });
    }
  });

  // ── Presence cleanup on disconnect ─────────────────────────────────────────
  socket.on("disconnect", async () => {
    if (!authed()) return;
    // Mark this user's active admitted sessions as "left" so reconnects don't
    // create phantom participants. (Clients reconcile via getActiveMeeting.)
    try {
      const active = await Meeting.find({
        status: "active",
        "participants.user": socket.authUser._id,
      });
      for (const m of active) {
        const p = m.participants.find((x) => oid(x.user) === socket.authUser._id);
        if (p && p.role !== "host" && p.state === "admitted") {
          p.state = "left";
          p.updatedAt = new Date();
          await m.save();
          io.to(`collab:${oid(m.roomId)}`).emit("meeting:participant-left", {
            meeting: { id: oid(m._id) },
            userId: socket.authUser._id,
          });
        }
      }
    } catch (err) {
      console.error("[meeting.socket] disconnect cleanup:", err.message);
    }
  });
}
