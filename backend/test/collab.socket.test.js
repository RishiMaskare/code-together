import assert from "node:assert/strict";
import test from "node:test";
import {
  registerCollabSocketHandlers,
  registerTeamCollabSocketHandlers,
} from "../src/lib/collab.socket.js";

function createCollabSocket(userId = "user-1") {
  const handlers = new Map();
  const emitted = [];
  const socket = {
    authUser: { _id: userId, fullName: "Test User" },
    handshake: { query: { userId } },
    rooms: new Set(["socket-1"]),
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    async join(room) {
      this.rooms.add(room);
    },
    leave(room) {
      this.rooms.delete(room);
    },
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
  return { socket, handlers, emitted };
}

test("collaboration rooms only admit authenticated participants after acceptance", async () => {
  const { socket, handlers, emitted } = createCollabSocket();
  const io = { to: () => ({ emit() {} }) };
  let isActive = false;
  registerCollabSocketHandlers(io, socket, {
    canJoinCollab: async (_collabId, userId) =>
      isActive && userId === "user-1",
  });

  await handlers.get("collab:join")({ collabId: "pending-collab" });
  assert.equal(socket.rooms.has("collab:pending-collab"), false);
  assert.deepEqual(emitted.at(-1), {
    event: "collab:join_denied",
    payload: {
      collabId: "pending-collab",
      message: "This collaboration starts after the request is accepted.",
    },
  });

  isActive = true;
  await handlers.get("collab:join")({ collabId: "pending-collab" });
  assert.equal(socket.rooms.has("collab:pending-collab"), true);
  assert.deepEqual(emitted.find((event) => event.event === "collab:joined"), {
    event: "collab:joined",
    payload: { collabId: "pending-collab", hasState: false },
  });

  await handlers.get("collab:leave")({ collabId: "pending-collab" });
  socket.authUser = null;
  await handlers.get("collab:join")({ collabId: "pending-collab" });
  assert.equal(socket.rooms.has("collab:pending-collab"), false);
  assert.equal(
    emitted.filter((event) => event.event === "collab:join_denied").length,
    2
  );
});

test("collaboration events only broadcast to accepted rooms and use socket identity", async () => {
  const { socket, handlers, emitted } = createCollabSocket();
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
  registerCollabSocketHandlers(io, socket, {
    canJoinCollab: async () => true,
  });
  await handlers.get("collab:join")({ collabId: "active-collab" });

  handlers.get("collab:editor_change")({
    collabId: "active-collab",
    content: "updated",
    filePath: "main.js",
    language: "javascript",
    userId: "spoofed-user",
  });
  handlers.get("collab:run_output")({
    collabId: "active-collab",
    output: "42",
    userId: "spoofed-user",
  });
  handlers.get("collab:editor_change")({
    collabId: "other-collab",
    content: "not allowed",
    filePath: "main.js",
  });

  assert.deepEqual(
    emitted.filter((event) => event.event === "collab:editor_change"),
    [{
      room: "collab:active-collab",
      event: "collab:editor_change",
      payload: {
        content: "updated",
        filePath: "main.js",
        language: "javascript",
        userId: "user-1",
        files: [{ path: "main.js", content: "updated" }],
        revision: 1,
      },
    }]
  );
  assert.deepEqual(
    emitted.find((event) => event.event === "collab:run_output").payload.userId,
    "user-1"
  );
});

test("a newly joined accepted participant receives the latest editor snapshot", async () => {
  const owner = createCollabSocket("owner");
  const newParticipant = createCollabSocket("new-participant");
  const io = { to: () => ({ emit() {} }) };
  const options = { canJoinCollab: async () => true };
  registerCollabSocketHandlers(io, owner.socket, options);
  registerCollabSocketHandlers(io, newParticipant.socket, options);

  await owner.handlers.get("collab:join")({ collabId: "snapshot-test" });
  owner.handlers.get("collab:editor_change")({
    collabId: "snapshot-test",
    content: "const live = true;",
    filePath: "main.js",
    language: "javascript",
  });
  await newParticipant.handlers.get("collab:join")({
    collabId: "snapshot-test",
  });

  assert.deepEqual(
    newParticipant.emitted.find((event) => event.event === "collab:sync_state"),
    {
    event: "collab:sync_state",
    payload: {
      content: "const live = true;",
      filePath: "main.js",
      language: "javascript",
      userId: "owner",
      files: [{ path: "main.js", content: "const live = true;" }],
      revision: 1,
    },
    }
  );
});

test("a new participant receives the complete latest local workspace", async () => {
  const owner = createCollabSocket("owner");
  const newParticipant = createCollabSocket("new-participant");
  const io = { to: () => ({ emit() {} }) };
  const options = { canJoinCollab: async () => true };
  registerCollabSocketHandlers(io, owner.socket, options);
  registerCollabSocketHandlers(io, newParticipant.socket, options);

  await owner.handlers.get("collab:join")({ collabId: "workspace-test" });
  owner.handlers.get("collab:workspace_initial")({
    collabId: "workspace-test",
    files: [
      { path: "main.js", content: "console.log('hello');" },
      { path: "utils.js", content: "export const add = (a, b) => a + b;" },
    ],
    filePath: "main.js",
    content: "console.log('hello');",
    language: "javascript",
  });
  await newParticipant.handlers.get("collab:join")({ collabId: "workspace-test" });

  assert.deepEqual(
    newParticipant.emitted.find((event) => event.event === "collab:sync_state").payload.files,
    [
      { path: "main.js", content: "console.log('hello');" },
      { path: "utils.js", content: "export const add = (a, b) => a + b;" },
    ]
  );
});

test("editor snapshots carry ordered revisions and update the workspace", async () => {
  const { socket, handlers, emitted } = createCollabSocket();
  const io = { to: () => ({ emit() {} }) };
  registerCollabSocketHandlers(io, socket, { canJoinCollab: async () => true });
  await handlers.get("collab:join")({ collabId: "revision-test" });

  handlers.get("collab:workspace_initial")({
    collabId: "revision-test",
    files: [{ path: "main.js", content: "one" }],
    filePath: "main.js",
    content: "one",
    language: "javascript",
  });
  handlers.get("collab:editor_change")({
    collabId: "revision-test",
    content: "two",
    filePath: "main.js",
    language: "javascript",
  });

  const updates = emitted.filter((event) => event.event === "collab:editor_change");
  assert.equal(updates[0].payload.revision, 2);
  assert.deepEqual(updates[0].payload.files, [{ path: "main.js", content: "two" }]);
});

test("share output is accepted only by the invited participant", async () => {
  const broadcasts = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          broadcasts.push({ room, event, payload });
        },
      };
    },
  };
  const owner = createCollabSocket("owner");
  const viewer = createCollabSocket("viewer");
  registerCollabSocketHandlers(io, owner.socket, {
    canJoinCollab: async () => true,
  });
  registerCollabSocketHandlers(io, viewer.socket, {
    canJoinCollab: async () => true,
  });

  await owner.handlers.get("collab:join")({ collabId: "share-test" });
  await viewer.handlers.get("collab:join")({ collabId: "share-test" });
  owner.handlers.get("collab:share_request")({
    collabId: "share-test",
    toUserId: "viewer",
  });
  viewer.handlers.get("collab:share_accepted")({
    collabId: "share-test",
    ownerUserId: "owner",
    viewerUserId: "spoofed-viewer",
  });

  assert.deepEqual(
    broadcasts.filter((event) => event.event === "collab:share_accepted"),
    [{
      room: "collab:share-test",
      event: "collab:share_accepted",
      payload: { viewerUserId: "viewer", ownerUserId: "owner" },
    }]
  );
});

test("team collaboration events use the same room as collab participants", () => {
  const handlers = new Map();
  const broadcasts = [];
  const socket = {
    authUser: { _id: "user-1" },
    rooms: new Set(["collab:team-123"]),
    on(event, handler) {
      handlers.set(event, handler);
    },
    to(room) {
      return {
        emit(event, payload) {
          broadcasts.push({ room, event, payload });
        },
      };
    },
  };

  registerTeamCollabSocketHandlers(socket);
  const payload = {
    collabId: "team-123",
    userId: "user-1",
    content: "console.log('hello')",
    filePath: "main.js",
  };

  handlers.get("team:take_control")(payload);
  handlers.get("team:release_control")({ collabId: "team-123" });
  handlers.get("team:request_state")({ collabId: "team-123" });

  assert.deepEqual(broadcasts, [
    { room: "collab:team-123", event: "team:take_control", payload },
    { room: "collab:team-123", event: "team:release_control", payload: undefined },
    { room: "collab:team-123", event: "team:request_state", payload: undefined },
  ]);
});

test("team collaboration events ignore missing room IDs", () => {
  const handlers = new Map();
  const socket = {
    authUser: { _id: "user-1" },
    rooms: new Set(),
    on(event, handler) {
      handlers.set(event, handler);
    },
    to() {
      assert.fail("Should not broadcast without a room ID");
    },
  };

  registerTeamCollabSocketHandlers(socket);
  handlers.get("team:take_control")();
  handlers.get("team:release_control")();
  handlers.get("team:request_state")();
});
