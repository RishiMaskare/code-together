import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  sendCollabRequest,
  acceptCollabRequest,
  rejectCollabRequest,
  getMyCollabs,
  getCollabById,
  githubOAuthCallback,
  disconnectGithub,
  createCollabRepo,
  getRepoFiles,
  getFileContent,
  commitFile,
} from "../controllers/collab.controller.js";

const router = express.Router();

// All routes protected
router.use(protectRoute);

// Collab lifecycle
router.post("/request/:friendId", sendCollabRequest);
router.put("/accept/:collabId", acceptCollabRequest);
router.put("/reject/:collabId", rejectCollabRequest);
router.get("/", getMyCollabs);
router.get("/:collabId", getCollabById);

// GitHub OAuth
router.get("/github/callback", githubOAuthCallback);
router.post("/github/disconnect", disconnectGithub);

// GitHub repo operations
router.post("/repo/:collabId", createCollabRepo);
router.get("/repo/:collabId/files", getRepoFiles);
router.get("/repo/:collabId/file", getFileContent);
router.post("/repo/:collabId/commit", commitFile);

export default router;
