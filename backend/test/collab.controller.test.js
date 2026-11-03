import assert from "node:assert/strict";
import test from "node:test";
import { acceptCollabRequest } from "../src/controllers/collab.controller.js";
import Collab from "../src/models/Collab.js";

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
    participants: ["requester-1", "invitee-1"],
    requester: "requester-1",
    status: "pending",
    async save() {},
    async populate() {
      return this;
    },
  };
}

test("the requester cannot accept their own collaboration request", async (t) => {
  const collab = createPendingCollab();
  t.mock.method(Collab, "findById", async () => collab);
  const response = createResponse();

  await acceptCollabRequest(
    { params: { collabId: collab._id }, user: { _id: "requester-1" } },
    response
  );

  assert.equal(response.statusCode, 403);
  assert.equal(collab.status, "pending");
});

test("the invited participant can accept a pending collaboration", async (t) => {
  const collab = createPendingCollab();
  t.mock.method(Collab, "findById", async () => collab);
  const response = createResponse();
  const io = { to: () => ({ emit() {} }) };

  await acceptCollabRequest(
    {
      params: { collabId: collab._id },
      user: { _id: "invitee-1" },
      app: { get: () => io },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(collab.status, "active");
  assert.equal(response.body, collab);
});
