import "./env.js";
import { StreamClient } from "@stream-io/node-sdk";

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

if (!apiKey || !apiSecret) {
  console.error("[streamVideo] STREAM_API_KEY / STREAM_API_SECRET is missing");
}

let adminClient = null;

/** Lazily-instantiated Stream admin client (server-side, uses the API secret). */
export function getVideoAdmin() {
  if (!adminClient) adminClient = new StreamClient(apiKey, apiSecret);
  return adminClient;
}

/**
 * Ensure a Stream Video call exists for this meeting.
 * Creating it server-side means the call's `created_by` is the trusted host id,
 * and lets us manage call-level permission settings from the backend.
 *
 * Throws on failure so callers can decide how to degrade.
 */
export async function ensureVideoCall(streamCallId, hostUserId) {
  const client = getVideoAdmin();
  const call = client.video.call("default", streamCallId);
  await call.getOrCreate({
    data: {
      created_by_id: String(hostUserId),
      created_by_role: "user",
      // Backend is the authority for call lifecycle; members manage their own tracks.
      settings_override: {},
    },
  });
  return call;
}
