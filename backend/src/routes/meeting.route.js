import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  startMeeting,
  getActiveMeeting,
  requestJoin,
  admitParticipant,
  declineParticipant,
  removeParticipant,
  leaveMeeting,
  setMeetingLock,
  endMeeting,
  getMediaToken,
  getMessages,
} from "../controllers/meeting.controller.js";

const router = express.Router();

// Everything below requires an authenticated user (JWT cookie).
router.use(protectRoute);

// ── Room-scoped meeting lifecycle ────────────────────────────────────────────
router.post("/rooms/:roomId/meetings/start", startMeeting);
router.get("/rooms/:roomId/meetings/active", getActiveMeeting);

// ── Meeting-scoped actions ───────────────────────────────────────────────────
router.post("/meetings/:meetingId/join-request", requestJoin);
router.post("/meetings/:meetingId/admit/:userId", admitParticipant);
router.post("/meetings/:meetingId/decline/:userId", declineParticipant);
router.post("/meetings/:meetingId/remove/:userId", removeParticipant);
router.post("/meetings/:meetingId/leave", leaveMeeting);
router.patch("/meetings/:meetingId/lock", setMeetingLock);
router.post("/meetings/:meetingId/end", endMeeting);

// ── Authorization-gated resources ────────────────────────────────────────────
router.get("/meetings/:meetingId/media-token", getMediaToken);
router.get("/meetings/:meetingId/messages", getMessages);

export default router;
