import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  sendCollabRequest, acceptCollabRequest, rejectCollabRequest,
  getMyCollabs, getCollabById, githubOAuthCallback, disconnectGithub,
  createCollabRepo, getRepoFiles, getFileContent, commitFile,
  executeCode,sendTeamCollabRequest, askCodeAssistant
} from "../controllers/collab.controller.js";

const router = express.Router();

// ── No auth — GitHub redirects here directly ──────────────────────────────────
router.get("/github/callback", githubOAuthCallback);

// ── Protected ─────────────────────────────────────────────────────────────────
router.use(protectRoute);

router.get("/", getMyCollabs);
router.post("/request/:friendId", sendCollabRequest);
router.put("/accept/:collabId", acceptCollabRequest);
router.put("/reject/:collabId", rejectCollabRequest);
router.post("/github/disconnect", disconnectGithub);

// Repo routes — specific paths before /:collabId wildcard
router.post("/repo/:collabId", createCollabRepo);
router.get("/repo/:collabId/files", getRepoFiles);
router.get("/repo/:collabId/file", getFileContent);
router.post("/repo/:collabId/commit", commitFile);
// Don't forget to import sendTeamCollabRequest at the top!
router.post("/team-request", sendTeamCollabRequest);

// Code execution proxy — avoids CORS in browser
router.post("/execute", executeCode);

// AI Assistant Route
router.post("/ask-ai", askCodeAssistant);

// Wildcard LAST
router.get("/:collabId", getCollabById);

export default router;