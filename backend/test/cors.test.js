import assert from "node:assert/strict";
import test from "node:test";
import { createCorsOptions } from "../src/lib/cors.js";

function isOriginAllowed(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) {
        reject(error);
      } else {
        resolve(allowed);
      }
    });
  });
}

test("development CORS allows local Vite origins and the configured frontend", async () => {
  const options = createCorsOptions({
    frontendUrl: "https://app.example.com/",
    nodeEnv: "development",
  });

  assert.equal(await isOriginAllowed(options, "http://localhost:5173"), true);
  assert.equal(await isOriginAllowed(options, "http://127.0.0.1:5174"), true);
  assert.equal(await isOriginAllowed(options, "https://app.example.com"), true);
  assert.equal(await isOriginAllowed(options, "https://other.example.com"), false);
  assert.equal(await isOriginAllowed(options, undefined), true);
});

test("production CORS does not allow local development origins", async () => {
  const options = createCorsOptions({
    frontendUrl: "https://app.example.com/",
    nodeEnv: "production",
  });

  assert.equal(await isOriginAllowed(options, "https://app.example.com"), true);
  assert.equal(await isOriginAllowed(options, "http://localhost:5173"), false);
});
