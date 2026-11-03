import assert from "node:assert/strict";
import test from "node:test";

process.env.STREAM_API_KEY ||= "stream-video-test-key";
process.env.STREAM_API_SECRET ||= "stream-video-test-secret";

const { ensureVideoCall, generateVideoCallToken, getVideoAdmin } = await import("../src/lib/streamVideo.js");

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("video tokens are scoped to the authenticated user and meeting call", () => {
  const token = generateVideoCallToken("call-123", "user-456");
  const payload = decodePayload(token);

  assert.equal(payload.user_id, "user-456");
  assert.equal(payload.role, "user");
  assert.deepEqual(payload.call_cids, ["default:call-123"]);
  assert.ok(payload.exp > payload.iat);
});

test("meeting calls enable the Stream screen-sharing setting", async () => {
  const admin = getVideoAdmin();
  const originalCall = admin.video.call;
  let callRequest;

  admin.video.call = (type, id) => ({
    getOrCreate: async (request) => {
      callRequest = { type, id, request };
    },
  });

  try {
    await ensureVideoCall("call-123", "host-456");
  } finally {
    admin.video.call = originalCall;
  }

  assert.equal(callRequest.type, "default");
  assert.equal(callRequest.id, "call-123");
  assert.equal(callRequest.request.data.created_by_id, "host-456");
  assert.equal(callRequest.request.data.settings_override.screensharing.enabled, true);
});
