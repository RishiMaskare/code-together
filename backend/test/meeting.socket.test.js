import assert from "node:assert/strict";
import test from "node:test";
import Meeting from "../src/models/Meeting.js";
import { registerMeetingSocketHandlers } from "../src/lib/meeting.socket.js";

function createMeeting() {
  return {
    _id: "meeting-1",
    roomId: "collab-1",
    streamCallId: "call-1",
    host: "host-1",
    status: "active",
    isLocked: "open",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    participants: [
      {
        user: "host-1",
        name: "Host",
        role: "host",
        state: "admitted",
        avatar: "/host.png",
      },
      {
        user: "guest-1",
        name: "Guest",
        role: "participant",
        state: "admitted",
        avatar: "/guest.png",
      },
    ],
    async save() {},
  };
}

test("disconnecting an active meeting host notifies the other participant", async (t) => {
  const meeting = createMeeting();
  t.mock.method(Meeting, "find", async () => [meeting]);
  const handlers = new Map();
  const events = [];
  const socket = {
    authUser: { _id: "host-1" },
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  const io = {
    in() {
      return { fetchSockets: async () => [] };
    },
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        },
      };
    },
  };

  registerMeetingSocketHandlers(io, socket);
  await handlers.get("disconnect")();

  assert.equal(meeting.participants[0].state, "left");
  assert.equal(events[0].room, "collab:collab-1");
  assert.equal(events[0].event, "meeting:participant-left");
  assert.equal(events[0].payload.meeting.participants[0].state, "left");
  assert.equal(events[0].payload.meeting.participants[1].state, "admitted");
});

test("disconnecting one tab does not mark a user left while another socket remains in the room", async (t) => {
  const meeting = createMeeting();
  t.mock.method(Meeting, "find", async () => [meeting]);
  const handlers = new Map();
  const events = [];
  const socket = {
    authUser: { _id: "guest-1" },
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  const io = {
    in() {
      return {
        fetchSockets: async () => [{ authUser: { _id: "guest-1" } }],
      };
    },
    to(_room) {
      return {
        emit(event) {
          events.push(event);
        },
      };
    },
  };

  registerMeetingSocketHandlers(io, socket);
  await handlers.get("disconnect")();

  assert.equal(meeting.participants[1].state, "admitted");
  assert.deepEqual(events, []);
});
