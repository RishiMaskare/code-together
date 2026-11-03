import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptCollabRequest,
  rejectCollabRequest,
} from "../src/controllers/collab.controller.js";
import Collab from "../src/models/Collab.js";
import { isCollabActive } from "../src/lib/collabStatus.js";

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

function createPendingCollab() {
  return {
    _id: "collab-1",
    participants: [{ _id: "requester-1" }, { _id: "invitee-1" }],
    requester: "requester-1",
    status: "pending",
  };
}

test("the collaboration schema persists accepted requests as an accepted status", () => {
  assert.ok(Collab.schema.path("status").enumValues.includes("accepted"));
  assert.equal(isCollabActive("accepted"), true);
  assert.equal(isCollabActive("active"), true);
  assert.equal(isCollabActive("pending"), false);
});

test("the requester cannot accept their own collaboration request", async (t) => {
  const current = createPendingCollab();
  t.mock.method(Collab, "findOneAndUpdate", () => ({ populate: async () => null }));
  t.mock.method(Collab, "findById", () => ({
    select: async () => current,
  }));
  const response = createResponse();

  await acceptCollabRequest(
    { params: { collabId: current._id }, user: { _id: "requester-1" } },
    response
  );

  assert.equal(response.statusCode, 403);
  assert.equal(current.status, "pending");
});

test("the invited participant can accept a pending collaboration", async (t) => {
  const collab = createPendingCollab();
  t.mock.method(Collab, "findOneAndUpdate", () => ({
    populate: async () => ({ ...collab, status: "accepted" }),
  }));
  const response = createResponse();
  const events = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        },
      };
    },
  };

  await acceptCollabRequest(
    {
      params: { collabId: collab._id },
      user: { _id: "invitee-1" },
      app: { get: () => io },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "accepted");
  assert.deepEqual(
    events.map(({ room, event }) => ({ room, event })),
    [
      { room: "user:requester-1", event: "collab:request_accepted" },
      { room: "user:invitee-1", event: "collab:request_accepted" },
    ]
  );
});

test("a collaboration request can only be accepted once", async (t) => {
  const current = { ...createPendingCollab(), status: "accepted" };
  t.mock.method(Collab, "findOneAndUpdate", () => ({ populate: async () => null }));
  t.mock.method(Collab, "findById", () => ({
    select: async () => current,
  }));
  const response = createResponse();

  await acceptCollabRequest(
    { params: { collabId: current._id }, user: { _id: "invitee-1" } },
    response
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.message, "This collaboration request is no longer pending");
});

test("the invited user can reject a pending collaboration exactly once", async (t) => {
  const collab = {
    ...createPendingCollab(),
    participants: ["requester-1", "invitee-1"],
    status: "closed",
  };
  t.mock.method(Collab, "findOneAndUpdate", async () => collab);
  const events = [];
  const response = createResponse();

  await rejectCollabRequest(
    {
      params: { collabId: collab._id },
      user: { _id: "invitee-1" },
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
  assert.deepEqual(
    events.map(({ room, event }) => ({ room, event })),
    [
      { room: "user:requester-1", event: "collab:request_rejected" },
      { room: "user:invitee-1", event: "collab:request_rejected" },
    ]
  );
});
