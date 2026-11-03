import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  startMeeting as apiStart,
  getActiveMeeting,
  requestJoin,
  declineMeetingInvite,
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
  const [isDeclining, setIsDeclining] = useState(false);
  const [dismissedFor, setDismissedFor] = useState(null); // meetingId we declined/dismissed
  const leaveInProgressRef = useRef(null);

  // The room's authoritative host (from collab.requester) — used before a meeting exists.
  const isRoomHost = sameId(roomHostId, myId);
  const isHost = !!meeting && sameId(meeting.host, myId);
  const me = meeting?.participants?.find((p) => sameId(p.userId, myId)) || null;
  const myState = isHost ? "admitted" : me?.state || null;
  const joinRequests = meeting?.participants?.filter((p) => p.state === "requested") || [];

  const refreshActiveMeeting = useCallback(async () => {
    if (!roomId || !myId) return;
    try {
      const { meeting: activeMeeting } = await getActiveMeeting(roomId);
      setMeeting(activeMeeting);
      const myParticipant = activeMeeting?.participants?.find((participant) =>
        sameId(participant.userId, myId)
      );
      setJoined(
        !!activeMeeting &&
        (sameId(activeMeeting.host, myId) || myParticipant?.state === "admitted")
      );
    } catch (error) {
      console.error("load active meeting:", error);
    }
  }, [roomId, myId]);

  useEffect(() => {
    refreshActiveMeeting();
  }, [refreshActiveMeeting]);

  // Subscribe and reconcile persisted state after every initial connection/reconnect.
  useEffect(() => {
    if (!socket || !roomId || !myId) return;
    const subscribe = () => {
      socket.emit("meeting:subscribe", { roomId }, (result) => {
        if (!result?.ok) {
          toast.error(
            result?.error === "not_member"
              ? "You are not a member of this collaboration."
              : "Could not connect to meeting notifications."
          );
        }
      });
      refreshActiveMeeting();
    };
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.off("connect", subscribe);
      socket.emit("meeting:unsubscribe", { roomId });
    };
  }, [socket, roomId, myId, refreshActiveMeeting]);

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
    const onInviteDeclined = ({ meeting: m, userId, name }) => {
      setMeeting(m);
      if (sameId(m.host, myId) && !sameId(userId, myId)) {
        toast(`${name || "A participant"} declined the meeting invite.`, { icon: "📴" });
      }
    };

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

    const onLeft = ({ meeting: m, userId }) => {
      if (m) setMeeting(m);
      if (!sameId(userId, myId)) {
        const departed = m?.participants?.find((participant) => sameId(participant.userId, userId));
        toast(`${departed?.name || "A participant"} disconnected from the meeting.`, { icon: "📴" });
      }
    };

    socket.on("meeting:started", onStarted);
    socket.on("meeting:ended", onEnded);
    socket.on("meeting:state-updated", onStateUpdated);
    socket.on("meeting:join-requested", onJoinRequested);
    socket.on("meeting:invite-declined", onInviteDeclined);
    socket.on("meeting:participant-admitted", onAdmitted);
    socket.on("meeting:participant-declined", onDeclined);
    socket.on("meeting:participant-removed", onRemoved);
    socket.on("meeting:participant-left", onLeft);

    return () => {
      socket.off("meeting:started", onStarted);
      socket.off("meeting:ended", onEnded);
      socket.off("meeting:state-updated", onStateUpdated);
      socket.off("meeting:join-requested", onJoinRequested);
      socket.off("meeting:invite-declined", onInviteDeclined);
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
    if (!meeting || leaveInProgressRef.current === meeting.id) return;
    leaveInProgressRef.current = meeting.id;
    try {
      const { meeting: updatedMeeting } = await leaveMeeting(meeting.id);
      setMeeting(updatedMeeting);
    } catch (e) {
      console.error("leave:", e);
    } finally {
      if (leaveInProgressRef.current === meeting.id) {
        leaveInProgressRef.current = null;
      }
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

  const dismissIncoming = useCallback(async () => {
    if (!meeting || isDeclining) return;
    setDismissedFor(meeting.id);
    setIsDeclining(true);
    try {
      const { meeting: updatedMeeting } = await declineMeetingInvite(meeting.id);
      setMeeting(updatedMeeting);
    } catch (error) {
      setDismissedFor(null);
      toast.error(error.response?.data?.message || "Could not decline the meeting invite.");
    } finally {
      setIsDeclining(false);
    }
  }, [meeting, isDeclining]);

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
    isDeclining,
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
