import assert from "node:assert/strict";
import cookieParser from "cookie-parser";
import express from "express";
import { once } from "node:events";
import test from "node:test";
import jwt from "jsonwebtoken";
import { login, logout } from "../src/controllers/auth.controller.js";
import { safeUserProjection, serializeSafeUser } from "../src/lib/safeUser.js";
import { protectRoute } from "../src/middleware/auth.middleware.js";
import authRoutes from "../src/routes/auth.route.js";
import User from "../src/models/User.js";

const jwtSecret = "auth-test-secret";
process.env.JWT_SECRET = jwtSecret;

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    cookieArgs: undefined,
    clearCookieArgs: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(...args) {
      this.cookieArgs = args;
      return this;
    },
    clearCookie(...args) {
      this.clearCookieArgs = args;
      return this;
    },
  };
}

test("safe user serialization excludes password and GitHub access token", () => {
  const user = {
    _id: "user-1",
    fullName: "Test User",
    email: "test@example.com",
    password: "password-hash",
    githubAccessToken: "github-secret",
    githubUsername: "test-user",
  };

  const safeUser = serializeSafeUser(user);

  assert.equal(safeUser._id, user._id);
  assert.equal(safeUser.githubUsername, user.githubUsername);
  assert.equal("password" in safeUser, false);
  assert.equal("githubAccessToken" in safeUser, false);
});

test("valid login sets the JWT cookie and returns only safe user fields", async (t) => {
  const user = {
    _id: "user-1",
    fullName: "Test User",
    email: "test@example.com",
    password: "password-hash",
    githubAccessToken: "github-secret",
    matchPassword: async (password) => password === "correct-password",
  };
  t.mock.method(User, "findOne", async () => user);

  const response = createResponse();
  await login(
    { body: { email: user.email, password: "correct-password" } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal("password" in response.body.user, false);
  assert.equal("githubAccessToken" in response.body.user, false);
  assert.equal(response.cookieArgs[0], "jwt");
  assert.equal(jwt.verify(response.cookieArgs[1], jwtSecret).userId, user._id);
  assert.equal(response.cookieArgs[2].httpOnly, true);
  assert.equal(response.cookieArgs[2].secure, true);
  assert.equal(response.cookieArgs[2].sameSite, "none");
  assert.equal(response.cookieArgs[2].path, "/");
});

test("invalid login credentials are rejected", async (t) => {
  t.mock.method(User, "findOne", async () => null);

  const response = createResponse();
  await login(
    { body: { email: "missing@example.com", password: "incorrect" } },
    response
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.cookieArgs, undefined);
});

test("auth middleware accepts a valid JWT and selects safe user fields", async (t) => {
  const user = { _id: "user-1", fullName: "Test User" };
  let selectedFields;
  t.mock.method(User, "findById", () => ({
    select: async (fields) => {
      selectedFields = fields;
      return user;
    },
  }));
  const req = {
    cookies: { jwt: jwt.sign({ userId: user._id }, jwtSecret) },
  };
  const response = createResponse();
  let nextCalled = false;

  await protectRoute(req, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user, user);
  assert.equal(selectedFields, safeUserProjection);
});

test("auth middleware rejects missing and invalid JWT cookies", async () => {
  for (const cookies of [{}, { jwt: "invalid-token" }]) {
    const response = createResponse();
    await protectRoute({ cookies }, response, () => {
      assert.fail("next should not be called for an invalid session");
    });

    assert.equal(response.statusCode, 401);
  }
});

test("GET /api/auth/me accepts a valid cookie and rejects missing or invalid cookies", async (t) => {
  const user = {
    _id: "user-1",
    fullName: "Test User",
    email: "test@example.com",
    password: "password-hash",
    githubAccessToken: "github-secret",
  };
  t.mock.method(User, "findById", () => ({
    select: async () => user,
  }));

  const app = express();
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  const url = `http://127.0.0.1:${server.address().port}/api/auth/me`;
  const token = jwt.sign({ userId: user._id }, jwtSecret);
  const authorizedResponse = await fetch(url, {
    headers: { cookie: `jwt=${token}` },
  });
  const authorizedBody = await authorizedResponse.json();

  assert.equal(authorizedResponse.status, 200);
  assert.equal(authorizedBody.user._id, user._id);
  assert.equal("password" in authorizedBody.user, false);
  assert.equal("githubAccessToken" in authorizedBody.user, false);

  const missingCookieResponse = await fetch(url);
  assert.equal(missingCookieResponse.status, 401);

  const invalidCookieResponse = await fetch(url, {
    headers: { cookie: "jwt=invalid-token" },
  });
  assert.equal(invalidCookieResponse.status, 401);
});

test("logout clears the JWT cookie with the matching cookie scope", async () => {
  const response = createResponse();
  await logout({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.clearCookieArgs[0], "jwt");
  assert.equal(response.clearCookieArgs[1].httpOnly, true);
  assert.equal(response.clearCookieArgs[1].secure, true);
  assert.equal(response.clearCookieArgs[1].sameSite, "none");
  assert.equal(response.clearCookieArgs[1].path, "/");
});
