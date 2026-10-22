import crypto from "crypto";
import Collab from "../models/Collab.js";
import Meeting from "../models/Meeting.js";
import MeetingMessage from "../models/MeetingMessage.js";
import { generateStreamToken } from "../lib/stream.js";
import { ensureVideoCall } from "../lib/streamVideo.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const oid = (v) => String(v && (v._id || v));

/** Verify the requester is a member of the Collab room; return membership info. */
async function resolveRoom(roomId, userId) {
  const collab = await Collab.findById(roomId);
  if (!collab) return { error: 404, message: "Room not found" };
  // The room creator (requester) is the authoritative host and is always a member,
  // even though the Collab schema keeps `requester` separate from the `participants` array.
  const isHost = oid(collab.requester) === oid(userId);
  const memberIds = collab.participants.map(oid);
  const isMember = isHost || memberIds.includes(oid(userId));
  if (!isMember) return { error: 403, message: "You are not a member of this room" };
  return { collab, isMember, isHost };
}

/** Find the current ACTIVE meeting for a room. */
function activeMeetingForRoom(roomId) {
  return Meeting.findOne({ roomId, status: "active" });
}

/** Find an active meeting by id (or null). */
function activeMeetingById(meetingId) {
  return Meeting.findOne({ _id: meetingId, status: "active" });
}

/** Shape a meeting for the client (no secrets, minimal fields). */
export function serializeMeeting(m) {
  const host = m.participants.find((p) => p.role === "host");
  return {
    id: oid(m._id),
    roomId: oid(m.roomId),
    streamCallId: m.streamCallId,
    host: oid(m.host),
    hostName: host?.name || "",
    status: m.status,
    isLocked: m.isLocked,
    startedAt: m.startedAt,
    participants: m.participants.map((p) => ({
      userId: oid(p.user),
      name: p.name,
      avatar: p.avatar,
      role: p.role,
      state: p.state,
    })),
  };
}

function ioEmit(io, event, payload, roomId) {
  if (io && roomId) io.to(`collab:${roomId}`).emit(event, payload);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

/** POST /api/rooms/:roomId/meetings/start  (host only) */
export async function startMeeting(req, res) {
  try {
    const userId = req.user._id;
    const { roomId } = req.params;
    const { collab, isHost, error, message } = await resolveRoom(roomId, userId);
    if (error) return res.status(error).json({ message });
    if (!isHost) return res.status(403).json({ message: "Only the room host can start a meeting" });

    // Idempotent: return the existing active meeting if one already exists.
    const existing = await activeMeetingForRoom(roomId);
    if (existing) return res.status(200).json({ meeting: serializeMeeting(existing) });

    const streamCallId = `ct-${crypto.randomBytes(8).toString("hex")}`;
    try {
      await ensureVideoCall(streamCallId, userId);
    } catch (e) {
      console.error("[meeting] ensureVideoCall failed:", e.message);
      return res.status(502).json({
        message: "Could not provision the video call. Ensure Stream Video is enabled for your app.",
      });
    }

    const meeting = await Meeting.create({
      roomType: "collab",
      roomId,
      streamCallId,
      host: userId,
      status: "active",
      isLocked: "open",
      participants: [
        {
          user: userId,
          name: req.user.fullName,
          avatar: req.user.profilePic || "",
          role: "host",
          state: "admitted",
          joinedAt: new Date(),
        },
      ],
    });

    const view = serializeMeeting(meeting);
    const io = req.app.get("io");
    // Tell everyone in the room a meeting started (clients show the incoming popup unless they are the host).
    ioEmit(io, "meeting:started", { meeting: view }, roomId);

    res.status(201).json({ meeting: view });
  } catch (err) {
    if (err?.code === 11000) {
      // A concurrent start already created the active meeting.
      const m = await activeMeetingForRoom(req.params.roomId);
      return res.status(200).json({ meeting: m ? serializeMeeting(m) : null });
    }
    console.error("[meeting] startMeeting:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** GET /api/rooms/:roomId/meetings/active */
export async function getActiveMeeting(req, res) {
  try {
    const { roomId } = req.params;
    const { error, message } = await resolveRoom(roomId, req.user._id);
    if (error) return res.status(error).json({ message });

    const meeting = await activeMeetingForRoom(roomId);
    res.json({ meeting: meeting ? serializeMeeting(meeting) : null });
  } catch (err) {
    console.error("[meeting] getActiveMeeting:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** POST /api/meetings/:meetingId/join-request  (any room member) */
export async function requestJoin(req, res) {
  try {
    const userId = req.user._id;
    const meeting = await activeMeetingById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting is not active" });

    const { isHost, error, message } = await resolveRoom(meeting.roomId, userId);
    if (error) return res.status(error).json({ message });

    const existing = meeting.participants.find((p) => oid(p.user) === oid(userId));

    // A declined/removed/locked participant cannot self-admit; they must be admitted by the host.
    if (existing && existing.state === "admitted") {
      // Re-authorization path (e.g. after a refresh) — already allowed in.
      return res.status(200).json({ state: "admitted", meeting: serializeMeeting(meeting) });
    }

    if (meeting.isLocked === "locked" && !isHost) {
      return res.status(403).json({ message: "The meeting is locked to new join requests" });
    }

    if (existing) {
      // requested / declined / left / removed -> move back to requested so the host can re-admit.
      existing.state = "requested";
      existing.updatedAt = new Date();
    } else {
      meeting.participants.push({
        user: userId,
        name: req.user.fullName,
        avatar: req.user.profilePic || "",
        role: "participant",
        state: "requested",
      });
    }
    await meeting.save();

    const view = serializeMeeting(meeting);
    const io = req.app.get("io");
    ioEmit(io, "meeting:join-requested", { meeting: view }, meeting.roomId);

    res.status(200).json({ state: "requested", meeting: view });
  } catch (err) {
    console.error("[meeting] requestJoin:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** Host action wrapper: mutate one participant's state and broadcast. */
async function hostSetParticipantState(req, res, { state, event, joinedAt }) {
  try {
    const meeting = await activeMeetingById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting is not active" });

    const { isHost, error, message } = await resolveRoom(meeting.roomId, req.user._id);
    if (error) return res.status(error).json({ message });
    if (!isHost) return res.status(403).json({ message: "Host only" });

    const targetId = req.params.userId;
    const p = meeting.participants.find((x) => oid(x.user) === oid(targetId));
    if (!p) return res.status(404).json({ message: "Participant not found" });

    p.state = state;
    p.updatedAt = new Date();
    if (joinedAt) p.joinedAt = new Date();
    await meeting.save();

    const view = serializeMeeting(meeting);
    const io = req.app.get("io");
    ioEmit(io, event, { meeting: view, userId: oid(targetId) }, meeting.roomId);

    res.json({ meeting: view });
  } catch (err) {
    console.error("[meeting] host participant action:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** POST /api/meetings/:meetingId/admit/:userId  (host only) */
export function admitParticipant(req, res) {
  return hostSetParticipantState(req, res, {
    state: "admitted",
    joinedAt: true,
    event: "meeting:participant-admitted",
  });
}

/** POST /api/meetings/:meetingId/decline/:userId  (host only) */
export function declineParticipant(req, res) {
  return hostSetParticipantState(req, res, {
    state: "declined",
    event: "meeting:participant-declined",
  });
}

/** POST /api/meetings/:meetingId/remove/:userId  (host only) */
export function removeParticipant(req, res) {
  return hostSetParticipantState(req, res, {
    state: "removed",
    event: "meeting:participant-removed",
  });
}

/** POST /api/meetings/:meetingId/leave  (self) */
export async function leaveMeeting(req, res) {
  try {
    const userId = req.user._id;
    const meeting = await activeMeetingById(req.params.meetingId);
    if (!meeting) return res.json({ ok: true });

    const p = meeting.participants.find((x) => oid(x.user) === oid(userId));
    if (p) {
      p.state = "left";
      p.updatedAt = new Date();
      await meeting.save();
    }
    const view = serializeMeeting(meeting);
    const io = req.app.get("io");
    ioEmit(io, "meeting:participant-left", { meeting: view, userId: oid(userId) }, meeting.roomId);
    res.json({ meeting: view });
  } catch (err) {
    console.error("[meeting] leaveMeeting:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** PATCH /api/meetings/:meetingId/lock  { locked: boolean } (host only) */
export async function setMeetingLock(req, res) {
  try {
    const meeting = await activeMeetingById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting is not active" });
    const { isHost, error, message } = await resolveRoom(meeting.roomId, req.user._id);
    if (error) return res.status(error).json({ message });
    if (!isHost) return res.status(403).json({ message: "Host only" });

    meeting.isLocked = req.body?.locked ? "locked" : "open";
    await meeting.save();

    const view = serializeMeeting(meeting);
    const io = req.app.get("io");
    ioEmit(io, "meeting:state-updated", { meeting: view }, meeting.roomId);
    res.json({ meeting: view });
  } catch (err) {
    console.error("[meeting] setMeetingLock:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** POST /api/meetings/:meetingId/end  (host only) */
export async function endMeeting(req, res) {
  try {
    const meeting = await activeMeetingById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting is not active" });
    const { isHost, error, message } = await resolveRoom(meeting.roomId, req.user._id);
    if (error) return res.status(error).json({ message });
    if (!isHost) return res.status(403).json({ message: "Only the host can end the meeting" });

    meeting.status = "ended";
    meeting.endedAt = new Date();
    await meeting.save();

    const io = req.app.get("io");
    ioEmit(io, "meeting:ended", { meetingId: oid(meeting._id), roomId: oid(meeting.roomId) }, meeting.roomId);

    res.json({ meeting: serializeMeeting(meeting) });
  } catch (err) {
    console.error("[meeting] endMeeting:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** GET /api/meetings/:meetingId/media-token  (host or admitted participants only) */
export async function getMediaToken(req, res) {
  try {
    const userId = req.user._id;
    const meeting = await Meeting.findById(req.params.meetingId);
    if (!meeting || meeting.status !== "active")
      return res.status(404).json({ message: "Meeting is not active" });

    const { error, message } = await resolveRoom(meeting.roomId, userId);
    if (error) return res.status(error).json({ message });

    const isHost = oid(meeting.host) === oid(userId);
    const p = meeting.participants.find((x) => oid(x.user) === oid(userId));

    // Gate the media token on admission. A declined/removed/requested/left user cannot get one.
    if (!isHost && (!p || p.state !== "admitted")) {
      return res.status(403).json({ message: "Not authorized to join this meeting yet" });
    }

    const token = generateStreamToken(oid(userId));
    res.json({
      token,
      apiKey: process.env.STREAM_API_KEY,
      streamCallId: meeting.streamCallId,
      userId: oid(userId),
      displayName: req.user.fullName,
      avatar: req.user.profilePic || "",
    });
  } catch (err) {
    console.error("[meeting] getMediaToken:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** GET /api/meetings/:meetingId/messages?before=<ISO>&limit=<n>  (participants only) */
export async function getMessages(req, res) {
  try {
    const userId = req.user._id;
    const meeting = await Meeting.findById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    const { isHost, error, message } = await resolveRoom(meeting.roomId, userId);
    if (error) return res.status(error).json({ message });
    const p = meeting.participants.find((x) => oid(x.user) === oid(userId));
    if (!isHost && (!p || p.state !== "admitted"))
      return res.status(403).json({ message: "Not a meeting participant" });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : new Date();

    const docs = await MeetingMessage.find({ meeting: meeting._id, createdAt: { $lt: before } })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const slice = docs.slice(0, limit);
    const messages = slice
      .map((d) => ({
        id: d._id.toString(),
        sender: oid(d.sender),
        senderName: d.senderName,
        senderAvatar: d.senderAvatar,
        text: d.text,
        createdAt: d.createdAt,
      }))
      .reverse();

    res.json({ messages, hasMore, nextCursor: slice.length ? slice[slice.length - 1].createdAt : before });
  } catch (err) {
    console.error("[meeting] getMessages:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
