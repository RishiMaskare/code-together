import assert from "node:assert/strict";
import test from "node:test";
import { registerTeamCollabSocketHandlers } from "../src/lib/collab.socket.js";

test("team collaboration events use the same room as collab participants", () => {
  const handlers = new Map();
  const broadcasts = [];
  const socket = {
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
