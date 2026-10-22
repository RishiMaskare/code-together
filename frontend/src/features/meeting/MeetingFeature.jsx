import React from "react";
import {
  PhoneIcon, PhoneOffIcon, VideoIcon, XIcon, CheckIcon, UsersIcon,
} from "lucide-react";
import { useMeeting } from "./useMeeting.js";
import MeetingRoom from "./MeetingRoom.jsx";

// ── Non-blocking incoming-meeting popup ──────────────────────────────────────
function IncomingMeetingPopup({ meeting, hostName, onJoin, onDecline, isJoining }) {
  return (
    <div className="fixed bottom-6 right-6 z-[60] w-80 max-w-[calc(100vw-2rem)]">
      <div className="card bg-base-100 shadow-2xl border border-base-300 animate-[slideIn_.2s_ease-out]">
        <div className="flex items-center gap-3 bg-primary text-primary-content px-4 py-3 rounded-t-xl">
          <span className="relative flex size-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full size-3 bg-white" />
          </span>
          <h3 className="font-bold text-sm flex-1 truncate">Incoming meeting</h3>
          <button className="opacity-70 hover:opacity-100" onClick={onDecline} aria-label="Dismiss">
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="avatar">
              <div className="w-11 rounded-full ring ring-primary/30">
                <img src={`/avatar.png`} alt="" onError={(e) => { e.currentTarget.src = "/avatar.png"; }} />
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{hostName || "The host"}</p>
              <p className="text-xs opacity-60">is meeting in room {meeting.roomId}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-success btn-sm flex-1 gap-1" onClick={onJoin} disabled={isJoining}>
              {isJoining ? <span className="loading loading-spinner loading-xs" /> : <><PhoneIcon className="size-4" /> Join</>}
            </button>
            <button className="btn btn-error btn-outline btn-sm flex-1 gap-1" onClick={onDecline}>
              <PhoneOffIcon className="size-4" /> Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Waiting-for-host / declined full overlay ─────────────────────────────────
function MeetingWaitingScreen({ meeting, myState, isJoining, onCancel }) {
  const declined = myState === "declined";
  return (
    <div className="fixed inset-0 z-[55] bg-base-300/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-2xl max-w-md w-full text-center space-y-5 p-8">
        <div className={`mx-auto size-16 rounded-full grid place-items-center ${declined ? "bg-error/15 text-error" : "bg-info/15 text-info"}`}>
          {declined ? <PhoneOffIcon className="size-8" /> : <UsersIcon className="size-8 animate-pulse" />}
        </div>
        <div className="space-y-1">
          <h3 className="font-bold text-xl">{declined ? "Request declined" : "Waiting for the host…"}</h3>
          <p className="text-sm opacity-70">
            {declined
              ? "The host hasn't let you in yet. You can try again later."
              : isJoining ? "Sending your request…" : "The host will admit you shortly."}
          </p>
        </div>
        <div className="text-xs opacity-50">Room {meeting?.roomId}</div>
        <button className="btn btn-ghost w-full" onClick={onCancel}>Back to the room</button>
      </div>
    </div>
  );
}

// ── Floating pill: Start / Join / In-meeting ─────────────────────────────────
function MeetingPill({ isHost, hasActive, joined, activeCount, onStart, onJoin, onRejoin, busy }) {
  if (joined) return null; // full-screen room is shown instead

  let label, icon, cls, onClick = onStart;
  if (hasActive && !isHost) {
    label = "Join meeting"; icon = <PhoneIcon className="size-4" />; cls = "btn-success"; onClick = onJoin;
  } else if (hasActive && isHost) {
    label = "Back to meeting"; icon = <VideoIcon className="size-4" />; cls = "btn-primary"; onClick = onRejoin;
  } else {
    label = "Start meeting"; icon = <VideoIcon className="size-4" />; cls = "btn-primary";
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <button className={`btn btn-sm shadow-lg gap-2 ${cls}`} onClick={onClick} disabled={busy}>
        {busy ? <span className="loading loading-spinner loading-xs" /> : icon}
        {label}
        {hasActive && (
          <span className="badge badge-xs badge-neutral ml-0.5">{activeCount}</span>
        )}
      </button>
    </div>
  );
}

/**
 * MeetingFeature — drop-in video conferencing for a room page.
 *
 * <MeetingFeature roomId={collabId} authUser={authUser} socket={socket} roomHostId={collab?.requester?._id || collab?.requester} />
 */
const MeetingFeature = ({ roomId, authUser, socket, roomHostId }) => {
  const m = useMeeting({ roomId, authUser, socket, roomHostId });

  if (!m.meeting) {
    // No active meeting: only the authoritative room host can start one.
    if (m.canStart) {
      return (
        <MeetingPill
          isHost
          hasActive={false}
          joined={false}
          activeCount={0}
          onStart={m.start}
          busy={m.isJoining}
        />
      );
    }
    return null;
  }

  // Determine whether this user is even allowed to see meeting affordances.
  // (Only room members subscribe; non-members simply get nothing.)

  const actions = {
    admit: m.admit,
    decline: m.decline,
    remove: m.remove,
    leave: m.leave,
    end: m.end,
    toggleLock: m.toggleLock,
  };

  return (
    <>
      {/* In-call full-screen experience */}
      {m.joined && <MeetingRoom meeting={m.meeting} myId={authUser?._id} socket={socket} actions={actions} />}

      {/* Waiting / declined overlay when a request is pending */}
      {!m.joined && (m.myState === "requested" || m.isJoining) && (
        <MeetingWaitingScreen meeting={m.meeting} myState={m.myState} isJoining={m.isJoining} onCancel={m.leave} />
      )}

      {/* Non-blocking incoming popup for members who aren't in the call */}
      {m.showIncoming && (
        <IncomingMeetingPopup
          meeting={m.meeting}
          hostName={m.meeting.hostName}
          onJoin={m.joinMeeting}
          onDecline={m.dismissIncoming}
          isJoining={m.isJoining}
        />
      )}

      {/* Persistent pill while a meeting is active (join/rejoin) */}
      {!m.joined && !m.showIncoming && (
        <MeetingPill
          isHost={m.isHost}
          hasActive
          joined={m.joined}
          activeCount={m.activeCount}
          onJoin={m.joinMeeting}
          onRejoin={() => m.joinMeeting()}
          busy={m.isJoining}
        />
      )}
    </>
  );
};

export default MeetingFeature;
