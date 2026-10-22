import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  StreamTheme,
  SpeakerLayout,
  CallControls,
  DeviceSettings,
  MenuToggle,
  MenuVisualType,
  CallingState,
  useCall,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import {
  UsersIcon, MessageCircleIcon, XIcon, PhoneOffIcon, PhoneCallIcon,
  LockIcon, UnlockIcon, ShieldIcon, VideoIcon, MicIcon, SettingsIcon,
} from "lucide-react";
import { getMediaToken, getMeetingMessages } from "../../lib/meeting.api.js";

const sameId = (a, b) => String(a) === String(b);
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ── Device-settings trigger (camera / mic / speaker) rendered via the SDK ─────
const SettingsGearButton = React.forwardRef(({ menuShown }, ref) => (
  <button
    ref={ref}
    className={`btn btn-sm btn-square ${menuShown ? "btn-primary" : "btn-ghost"}`}
    aria-label="Device settings"
  >
    <SettingsIcon className="size-4" />
  </button>
));
SettingsGearButton.displayName = "SettingsGearButton";

// ── Meeting chat (Socket.IO control-plane, persisted in Mongo) ────────────────
function MeetingChat({ socket, meetingId, myId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const seenRef = useRef(new Set());
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  const merge = (incoming) => {
    setMessages((prev) => {
      const next = [...prev];
      for (const m of incoming) {
        if (!seenRef.current.has(m.id)) {
          seenRef.current.add(m.id);
          next.push(m);
        }
      }
      return next.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { messages: hist } = await getMeetingMessages(meetingId, { limit: 50 });
        if (alive) {
          merge(hist);
          setStatus("ready");
        }
      } catch (e) {
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (m) => {
      if (String(m.meetingId) !== String(meetingId)) return;
      merge([m]);
    };
    socket.on("meeting:chat-message", onMsg);
    return () => socket.off("meeting:chat-message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, meetingId]);

  useEffect(() => {
    if (stickToBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = () => {
    const clean = text.trim();
    if (!clean) return;
    socket?.emit("meeting:chat-message", { meetingId, text: clean }, (res) => {
      if (!res?.ok && res?.error === "rate_limited") toast.error("Slow down — too many messages.");
    });
    setText("");
    stickToBottom.current = true;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-base-300 shrink-0">
        <h3 className="font-bold text-sm flex items-center gap-2"><MessageCircleIcon className="size-4" /> Meeting chat</h3>
        <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close chat"><XIcon className="size-4" /></button>
      </div>

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {status === "loading" && <p className="text-xs opacity-50 text-center py-6">Loading messages…</p>}
        {status === "error" && <p className="text-xs text-center py-6 opacity-60">Couldn't load chat history.</p>}
        {status === "ready" && messages.length === 0 && (
          <div className="text-center opacity-50 py-10 space-y-1">
            <MessageCircleIcon className="size-8 mx-auto" />
            <p className="text-xs">No messages yet. Say hello 👋</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = sameId(m.sender, myId);
          return (
            <div key={m.id} className={`chat ${mine ? "chat-end" : "chat-start"}`}>
              <div className="chat-image avatar avatar-xs">
                <div className="rounded-full w-full"><img src={m.senderAvatar || "/avatar.png"} alt="" /></div>
              </div>
              <div className="chat-header text-[10px] opacity-60">
                {mine ? "You" : m.senderName} · {fmtTime(m.createdAt)}
              </div>
              <div className={`chat-bubble text-sm ${mine ? "chat-bubble-primary" : "bg-base-200"} break-words max-w-[16rem]`}>
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-2 border-t border-base-300 shrink-0">
        <div className="flex gap-2">
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="Message…"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ── Participants panel: server-authoritative roster + host moderation ─────────
// Connection quality & speaking/mic/cam are shown directly on the video tiles
// (Stream SpeakerLayout renders ParticipantView with those indicators).
function ParticipantsPanel({ meeting, myId, isHost, onAdmit, onDecline, onRemove, onMute, onClose }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-base-300 shrink-0">
        <h3 className="font-bold text-sm flex items-center gap-2"><UsersIcon className="size-4" /> People ({meeting.participants.length})</h3>
        <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close participants"><XIcon className="size-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {isHost && meeting.participants.some((p) => p.state === "requested") && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-60">Waiting room</p>
            {meeting.participants.filter((p) => p.state === "requested").map((p) => (
              <div key={p.userId} className="flex items-center gap-2 bg-warning/10 rounded-lg p-2 border border-warning/30">
                <div className="avatar avatar-sm"><div className="rounded-full w-8"><img src={p.avatar || "/avatar.png"} alt="" /></div></div>
                <span className="text-sm flex-1 truncate">{p.name}</span>
                <button className="btn btn-success btn-xs" onClick={() => onAdmit(p.userId)}><PhoneCallIcon className="size-3" /></button>
                <button className="btn btn-error btn-xs" onClick={() => onDecline(p.userId)}><XIcon className="size-3" /></button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold uppercase tracking-wider opacity-60">In the meeting</p>
        {meeting.participants.filter((p) => p.state === "admitted").map((p) => (
          <div key={p.userId} className="flex items-center gap-2 p-2 rounded-lg hover:bg-base-200">
            <div className="avatar avatar-sm relative">
              <div className="rounded-full w-8"><img src={p.avatar || "/avatar.png"} alt="" /></div>
              <span className="badge badge-xs badge-success absolute -bottom-1 -right-1 border-base-100" title="In the meeting" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate flex items-center gap-1">
                {p.name}{sameId(p.userId, myId) && <span className="text-xs opacity-60">(you)</span>}
                {p.role === "host" && <ShieldIcon className="size-3 text-primary" />}
              </p>
            </div>
            {isHost && !sameId(p.userId, myId) && (
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost btn-xs" title="Force mute" onClick={() => onMute(p.userId)}><MicIcon className="size-3" /></button>
                <button className="btn btn-ghost btn-xs text-error" title="Remove from meeting" onClick={() => onRemove(p.userId)}><XIcon className="size-3" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Inner UI (rendered within StreamCall context) ─────────────────────────────
function MeetingInner({ meeting, myId, socket, onClose }) {
  const call = useCall();
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();

  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const isHost = sameId(meeting.host, myId);
  const hostCallbacks = onClose; // {onAdmit,onDecline,onRemove,onLeave,onEnd,onToggleLock,onMute}

  // If the local user left the Stream call (via CallControls), sync server state.
  useEffect(() => {
    if (callingState === CallingState.LEFT) hostCallbacks.onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callingState]);

  const handleMute = async (userId) => {
    try {
      if (call?.session?.muteUsers) {
        await call.session.muteUsers({ userIds: [userId] });
      } else if (call?.muteUsers) {
        await call.muteUsers([userId]);
      } else {
        toast("Host mute isn't available for this call.");
        return;
      }
      toast.success("Participant muted.");
    } catch (e) {
      toast.error("Could not mute participant.");
    }
  };

  return (
    <StreamTheme>
      <div className="flex flex-col h-full bg-[#0b0d12] text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex size-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex rounded-full size-2.5 bg-red-500" /></span>
            <span className="font-bold truncate">Room {meeting.roomId}</span>
            <span className="badge badge-sm badge-neutral font-mono">LIVE</span>
            <span className="text-xs opacity-70 hidden sm:inline">{meeting.participants.filter(p=>p.state==="admitted").length} in · {meeting.participants.filter(p=>p.state==="requested").length} waiting</span>
          </div>

          <div className="flex items-center gap-1.5">
            <MenuToggle
              ToggleButton={SettingsGearButton}
              visualType={MenuVisualType.MENU}
              placement="bottom-end"
            >
              <DeviceSettings visualType={MenuVisualType.MENU} />
            </MenuToggle>
            <button className={`btn btn-sm btn-square ${showParticipants ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowParticipants((v) => !v)} aria-label="Participants"><UsersIcon className="size-4" /></button>
            <button className={`btn btn-sm btn-square ${showChat ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowChat((v) => !v)} aria-label="Chat"><MessageCircleIcon className="size-4" /></button>
            {isHost && (
              <>
                <button className="btn btn-sm btn-ghost btn-square" onClick={hostCallbacks.onToggleLock} title={meeting.isLocked === "locked" ? "Unlock" : "Lock"}>
                  {meeting.isLocked === "locked" ? <LockIcon className="size-4" /> : <UnlockIcon className="size-4" />}
                </button>
                <button className="btn btn-sm btn-error" onClick={hostCallbacks.onEnd}><PhoneOffIcon className="size-4 mr-1" /><span className="hidden sm:inline">End for all</span></button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 relative min-w-0">
            <SpeakerLayout />
          </div>
          {showParticipants && (
            <div className="w-72 shrink-0 border-l border-white/10 bg-base-100 text-base-content">
              <ParticipantsPanel
                meeting={meeting} myId={myId} isHost={isHost}
                onAdmit={hostCallbacks.onAdmit} onDecline={hostCallbacks.onDecline}
                onRemove={hostCallbacks.onRemove} onMute={handleMute}
                onClose={() => setShowParticipants(false)}
              />
            </div>
          )}
          {showChat && (
            <div className="w-80 shrink-0 border-l border-white/10 bg-base-100 text-base-content">
              <MeetingChat socket={socket} meetingId={meeting.id} myId={myId} onClose={() => setShowChat(false)} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/10 flex justify-center py-2">
          <CallControls onLeave={hostCallbacks.onLeave} />
        </div>
      </div>
    </StreamTheme>
  );
}

// ── Outer: manages the Stream client/call lifecycle via the gated media token ─
export default function MeetingRoom({ meeting, myId, socket, actions }) {
  const [client, setClient] = useState(null);
  const [call, setCall] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let localCall = null;
    let localClient = null;

    (async () => {
      try {
        const t = await getMediaToken(meeting.id); // 403 unless host/admitted
        if (cancelled) return;
        localClient = new StreamVideoClient({
          apiKey: t.apiKey,
          user: { id: t.userId, name: t.displayName, image: t.avatar || undefined },
          token: t.token,
        });
        localCall = localClient.call("default", t.streamCallId);
        await localCall.join({ create: false });
        if (cancelled) return;
        setClient(localClient);
        setCall(localCall);
      } catch (e) {
        if (cancelled) return;
        const status = e?.response?.status || e?.status;
        if (status === 403) setError("You aren't admitted to this meeting yet.");
        else setError("Could not connect to the meeting. Check your camera/mic permissions and connection.");
        console.error("MeetingRoom join:", e);
      }
    })();

    return () => {
      cancelled = true;
      try { localCall?.leave(); } catch { /* noop */ }
      try { localClient?.disconnectAllPages?.(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  const hostCallbacks = useMemo(() => ({
    onAdmit: actions.admit,
    onDecline: actions.decline,
    onRemove: actions.remove,
    onLeave: actions.leave,
    onEnd: actions.end,
    onToggleLock: actions.toggleLock,
  }), [actions]);

  if (error) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0b0d12]/95 text-white flex items-center justify-center p-6">
        <div className="card bg-base-100 text-base-content p-6 max-w-md w-full text-center space-y-4 shadow-2xl">
          <h3 className="font-bold text-lg">Can't join the meeting</h3>
          <p className="text-sm opacity-70">{error}</p>
          <button className="btn btn-primary w-full" onClick={actions.leave}>Back to the room</button>
        </div>
      </div>
    );
  }

  if (!client || !call) {
    return (
      <div className="absolute inset-0 z-50 bg-[#0b0d12] text-white flex flex-col items-center justify-center gap-4">
        <span className="loading loading-ring loading-lg" />
        <p className="text-sm opacity-80">Connecting you to the meeting…</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50">
      <StreamVideo client={client}>
        <StreamCall call={call}>
          <MeetingInner meeting={meeting} myId={myId} socket={socket} onClose={hostCallbacks} />
        </StreamCall>
      </StreamVideo>
    </div>
  );
}
