import assert from "node:assert/strict";
import test from "node:test";
import {
  declineMeetingInvite,
  requestJoin,
} from "../src/controllers/meeting.controller.js";
import Collab from "../src/models/Collab.js";
import Meeting from "../src/models/Meeting.js";

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createMeeting() {
  return {
    _id: "meeting-1",
    roomId: "collab-1",
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
      },
    ],
    async save() {},
  };
}

function createCollab() {
  return {
    requester: "host-1",
    status: "active",
    participants: ["host-1", "invitee-1"],
  };
}

test("a collaboration member can decline an incoming meeting invite", async (t) => {
  const meeting = createMeeting();
  t.mock.method(Meeting, "findOne", async () => meeting);
  t.mock.method(Collab, "findById", async () => createCollab());
  const events = [];
  const response = createResponse();

  await declineMeetingInvite(
    {
      params: { meetingId: meeting._id },
      user: { _id: "invitee-1", fullName: "Invitee", profilePic: "/invitee.png" },
      app: {
        get: () => ({
          to(room) {
            return {
              emit(event, payload) {
                events.push({ room, event, payload });
              },
            };
          },
        }),
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(
    meeting.participants.find((participant) => participant.user === "invitee-1").state,
    "declined"
  );
  assert.deepEqual(events.map(({ room, event }) => ({ room, event })), [
    { room: "collab:collab-1", event: "meeting:invite-declined" },
  ]);
});

test("the meeting host cannot decline their own invitation", async (t) => {
  const meeting = createMeeting();
  t.mock.method(Meeting, "findOne", async () => meeting);
  t.mock.method(Collab, "findById", async () => createCollab());
  const response = createResponse();

  await declineMeetingInvite(
    {
      params: { meetingId: meeting._id },
      user: { _id: "host-1", fullName: "Host" },
      app: { get: () => ({}) },
    },
    response
  );

  assert.equal(response.statusCode, 403);
  assert.equal(meeting.participants.length, 1);
});

test("accepting a meeting invitation admits a collaboration member immediately", async (t) => {
  const meeting = createMeeting();
  t.mock.method(Meeting, "findOne", async () => meeting);
  t.mock.method(Collab, "findById", async () => createCollab());
  const events = [];
  const response = createResponse();

  await requestJoin(
    {
      params: { meetingId: meeting._id },
      user: { _id: "invitee-1", fullName: "Invitee", profilePic: "/invitee.png" },
      app: {
        get: () => ({
          to(room) {
            return {
              emit(event, payload) {
                events.push({ room, event, payload });
              },
            };
          },
        }),
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.state, "admitted");
  assert.equal(
    meeting.participants.find((participant) => participant.user === "invitee-1").state,
    "admitted"
  );
  assert.deepEqual(events.map(({ room, event }) => ({ room, event })), [
    { room: "collab:collab-1", event: "meeting:participant-admitted" },
  ]);
});
