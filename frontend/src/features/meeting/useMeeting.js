import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  startMeeting as apiStart,
  getActiveMeeting,
  requestJoin,
  admitParticipant,
  declineParticipant,
  removeParticipant,
  leaveMeeting,
  setMeetingLock,
  endMeeting,
} from "../../lib/meeting.api.js";

const sameId = (a, b) => String(a) === String(b);

/**
 * useMeeting — meeting lifecycle orchestrator for a single room.
 *
 * Owns: current active meeting, my join state, incoming prompt, host actions.
 * Media itself is handled by <MeetingRoom> once `joined` flips true.
 */
export function useMeeting({ roomId, authUser, socket, roomHostId }) {
  const myId = authUser?._id;
  const [meeting, setMeeting] = useState(null);
  const [joined, setJoined] = useState(false); // in-call / media allowed
  const [isJoining, setIsJoining] = useState(false);
  const [dismissedFor, setDismissedFor] = useState(null); // meetingId we declined/dismissed
  const bootstrapped = useRef(false);

  // The room's authoritative host (from collab.requester) — used before a meeting exists.
  const isRoomHost = sameId(roomHostId, myId);
  const isHost = !!meeting && sameId(meeting.host, myId);
  const me = meeting?.participants?.find((p) => sameId(p.userId, myId)) || null;
  const myState = isHost ? "admitted" : me?.state || null;
  const joinRequests = meeting?.participants?.filter((p) => p.state === "requested") || [];

  // Keep the latest meeting in a ref so socket callbacks avoid stale closures.
  const meetingRef = useRef(meeting);
  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  // ── Bootstrap: load any currently-active meeting (handles refresh/reconnect) ──
  useEffect(() => {
    if (!roomId || bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const { meeting: m } = await getActiveMeeting(roomId);
        if (m) {
          setMeeting(m);
          const meP = m.participants?.find((p) => sameId(p.userId, myId));
          // Already admitted (or I'm the host) -> drop straight back into the call.
          if (sameId(m.host, myId) || meP?.state === "admitted") setJoined(true);
        }
      } catch (e) {
        console.error("load active meeting:", e);
      }
    })();
  }, [roomId, myId]);

  // ── Subscribe to the room's notification channel ─────────────────────────────
  useEffect(() => {
    if (!socket || !roomId || !myId) return;
    socket.emit("meeting:subscribe", { roomId });
    return () => socket.emit("meeting:unsubscribe", { roomId });
  }, [socket, roomId, myId]);

  // ── Socket lifecycle wiring ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !myId) return;

    const onStarted = ({ meeting: m }) => {
      setMeeting(m);
      if (sameId(m.host, myId)) {
        setJoined(true); // host auto-enters after starting
      }
    };

    const onEnded = () => {
      setMeeting(null);
      setJoined(false);
      setIsJoining(false);
      toast("The meeting has ended.", { icon: "📴" });
    };

    const onStateUpdated = ({ meeting: m }) => setMeeting(m);
    const onJoinRequested = ({ meeting: m }) => setMeeting(m);

    const onAdmitted = ({ meeting: m, userId }) => {
      setMeeting(m);
      if (sameId(userId, myId)) {
        setIsJoining(false);
        setJoined(true);
        toast.success("The host let you into the meeting.");
      }
    };

    const onDeclined = ({ meeting: m, userId }) => {
      setMeeting(m);
      if (sameId(userId, myId)) {
        setIsJoining(false);
        toast.error("Your join request was declined.");
      }
    };

    const onRemoved = ({ meeting: m, userId }) => {
      setMeeting(m);
      if (sameId(userId, myId)) {
        setJoined(false);
        toast.error("The host removed you from the meeting.");
      }
    };

    const onLeft = ({ meeting: m }) => {
      if (m) setMeeting(m);
    };

    socket.on("meeting:started", onStarted);
    socket.on("meeting:ended", onEnded);
    socket.on("meeting:state-updated", onStateUpdated);
    socket.on("meeting:join-requested", onJoinRequested);
    socket.on("meeting:participant-admitted", onAdmitted);
    socket.on("meeting:participant-declined", onDeclined);
    socket.on("meeting:participant-removed", onRemoved);
    socket.on("meeting:participant-left", onLeft);

    return () => {
      socket.off("meeting:started", onStarted);
      socket.off("meeting:ended", onEnded);
      socket.off("meeting:state-updated", onStateUpdated);
      socket.off("meeting:join-requested", onJoinRequested);
      socket.off("meeting:participant-admitted", onAdmitted);
      socket.off("meeting:participant-declined", onDeclined);
      socket.off("meeting:participant-removed", onRemoved);
      socket.off("meeting:participant-left", onLeft);
    };
  }, [socket, myId]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    try {
      const { meeting: m } = await apiStart(roomId);
      setMeeting(m);
      setJoined(true);
      toast.success("Meeting started.");
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not start the meeting.");
    }
  }, [roomId]);

  const joinMeeting = useCallback(async () => {
    if (!meeting) return;
    setIsJoining(true);
    try {
      const res = await requestJoin(meeting.id);
      if (res.state === "admitted") setJoined(true);
      else toast("Request sent — waiting for the host to admit you…", { icon: "⏳" });
      if (res.meeting) setMeeting(res.meeting);
    } catch (e) {
      setIsJoining(false);
      toast.error(e.response?.data?.message || "Could not request to join.");
    }
  }, [meeting]);

  const leave = useCallback(async () => {
    setJoined(false);
    setIsJoining(false);
    try {
      if (meeting) {
        const { meeting: m } = await leaveMeeting(meeting.id);
        setMeeting(m);
      }
    } catch (e) {
      console.error("leave:", e);
    }
  }, [meeting]);

  const end = useCallback(async () => {
    try {
      if (meeting) await endMeeting(meeting.id);
      setMeeting(null);
      setJoined(false);
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not end the meeting.");
    }
  }, [meeting]);

  const admit = useCallback(async (userId) => {
    try {
      const { meeting: m } = await admitParticipant(meeting.id, userId);
      setMeeting(m);
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not admit participant.");
    }
  }, [meeting]);

  const decline = useCallback(async (userId) => {
    try {
      const { meeting: m } = await declineParticipant(meeting.id, userId);
      setMeeting(m);
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not decline participant.");
    }
  }, [meeting]);

  const remove = useCallback(async (userId) => {
    try {
      const { meeting: m } = await removeParticipant(meeting.id, userId);
      setMeeting(m);
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not remove participant.");
    }
  }, [meeting]);

  const toggleLock = useCallback(async () => {
    try {
      const { meeting: m } = await setMeetingLock(meeting.id, meeting.isLocked !== "locked");
      setMeeting(m);
    } catch (e) {
      toast.error(e.response?.data?.message || "Could not update meeting lock.");
    }
  }, [meeting]);

  const dismissIncoming = useCallback(() => {
    if (meeting) setDismissedFor(meeting.id);
  }, [meeting]);

  // Show the incoming popup to non-host members while an active meeting exists,
  // they are not admitted/in-call, and they haven't dismissed THIS meeting.
  const showIncoming =
    !!meeting &&
    !joined &&
    !isHost &&
    myState !== "admitted" &&
    dismissedFor !== (meeting?.id || null);

  return {
    // state
    meeting,
    joined,
    isJoining,
    isHost,
    isRoomHost,
    canStart: isRoomHost && !meeting,
    myState,
    joinRequests,
    showIncoming,
    activeCount: meeting?.participants?.filter((p) => p.state === "admitted").length || 0,
    // actions
    start,
    joinMeeting,
    leave,
    end,
    admit,
    decline,
    remove,
    toggleLock,
    dismissIncoming,
  };
}
