import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import User from "../src/models/User.js";
import { authenticateSocket } from "../src/lib/socketAuth.js";

const jwtSecret = "socket-auth-test-secret";
process.env.JWT_SECRET = jwtSecret;

function createSocket({ token, cookie } = {}) {
  return {
    handshake: {
      auth: token ? { token } : {},
      headers: { cookie: cookie || "" },
    },
  };
}

test("socket tokens authenticate the user without trusting a client user ID", async (t) => {
  const user = {
    _id: { toString: () => "user-1" },
    fullName: "Socket User",
    email: "socket@example.com",
    profilePic: "/avatar.png",
  };
  t.mock.method(User, "findById", () => ({
    select: async () => user,
  }));
  const socket = createSocket({
    token: jwt.sign(
      { userId: "user-1", purpose: "socket" },
      jwtSecret,
      { expiresIn: "5m" }
    ),
  });
  let connectionError;

  await authenticateSocket(socket, (error) => {
    connectionError = error;
  });

  assert.equal(connectionError, undefined);
  assert.deepEqual(socket.authUser, {
    _id: "user-1",
    id: "user-1",
    fullName: "Socket User",
    email: "socket@example.com",
    profilePic: "/avatar.png",
  });
});

test("socket authentication rejects missing or non-socket handshake tokens", async () => {
  for (const socket of [
    createSocket(),
    createSocket({ token: jwt.sign({ userId: "user-1" }, jwtSecret) }),
  ]) {
    let connectionError;
    await authenticateSocket(socket, (error) => {
      connectionError = error;
    });
    assert.ok(connectionError instanceof Error);
  }
});
