import Collab from "../models/collab.model.js";
import User from "../models/User.js";
import { Octokit } from "@octokit/rest";
import { onlineUsers } from "../lib/collab.socket.js";

// ─── Collab Request ──────────────────────────────────────────────────────────

export const sendCollabRequest = async (req, res) => {
  try {
    const { friendId } = req.params;
    const myId = req.user._id;

    // check they are friends
    const me = await User.findById(myId);
    if (!me.friends.includes(friendId)) {
      return res.status(400).json({ message: "You can only collab with friends." });
    }

    // check no existing pending/active collab between them
    const existing = await Collab.findOne({
      participants: { $all: [myId, friendId] },
      status: { $in: ["pending", "active"] },
    });
    if (existing) {
      return res.status(400).json({ message: "A collab already exists between you two." });
    }

    const collab = await Collab.create({
      participants: [myId, friendId],
      requester: myId,
      status: "pending",
    });

    await collab.populate("participants", "-password -githubAccessToken");

    // ── Notify receiver via socket if they are online ──────────────────────────
    const io = req.app.get("io"); // we'll attach io to app in server.js
    const receiverSocketId = onlineUsers.get(friendId.toString());
    if (io && receiverSocketId) {
      io.to(receiverSocketId).emit("collab:new_request", {
        collab,
        requester: collab.participants.find(
          (p) => p._id.toString() === myId.toString()
        ),
      });
    }

    res.status(201).json(collab);
  } catch (err) {
    console.error("sendCollabRequest error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const acceptCollabRequest = async (req, res) => {
  try {
    const { collabId } = req.params;
    const collab = await Collab.findById(collabId);
    if (!collab) return res.status(404).json({ message: "Collab not found" });
    if (!collab.participants.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ message: "Not authorized" });
    }
    collab.status = "active";
    await collab.save();
    await collab.populate("participants", "-password -githubAccessToken");

    // Notify the requester that their request was accepted
    const io = req.app.get("io");
    const requesterSocketId = onlineUsers.get(collab.requester.toString());
    if (io && requesterSocketId) {
      io.to(requesterSocketId).emit("collab:request_accepted", { collab });
    }

    res.json(collab);
  } catch (err) {
    console.error("acceptCollabRequest error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const rejectCollabRequest = async (req, res) => {
  try {
    const { collabId } = req.params;
    const collab = await Collab.findById(collabId);
    if (!collab) return res.status(404).json({ message: "Collab not found" });
    collab.status = "closed";
    await collab.save();

    // Notify requester
    const io = req.app.get("io");
    const requesterSocketId = onlineUsers.get(collab.requester.toString());
    if (io && requesterSocketId) {
      io.to(requesterSocketId).emit("collab:request_rejected", {
        collabId: collab._id,
      });
    }

    res.json({ message: "Collab request rejected" });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getMyCollabs = async (req, res) => {
  try {
    const collabs = await Collab.find({
      participants: req.user._id,
      status: { $in: ["pending", "active"] },
    }).populate("participants", "-password -githubAccessToken");
    res.json(collabs);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getCollabById = async (req, res) => {
  try {
    const collab = await Collab.findById(req.params.collabId).populate(
      "participants",
      "-password -githubAccessToken"
    );
    if (!collab) return res.status(404).json({ message: "Collab not found" });
    res.json(collab);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────

export const githubOAuthCallback = async (req, res) => {
  try {
    const { code } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return res.status(400).json({ message: tokenData.error_description });
    }

    const accessToken = tokenData.access_token;
    const octokit = new Octokit({ auth: accessToken });
    const { data: ghUser } = await octokit.users.getAuthenticated();

    await User.findByIdAndUpdate(req.user._id, {
      githubAccessToken: accessToken,
      githubUsername: ghUser.login,
    });

    const collabId = req.query.state;
    res.redirect(`${process.env.FRONTEND_URL}/collab/${collabId}?github=connected`);
  } catch (err) {
    console.error("githubOAuthCallback error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const disconnectGithub = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      githubAccessToken: null,
      githubUsername: null,
    });
    res.json({ message: "GitHub disconnected" });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GitHub Repo Management ───────────────────────────────────────────────────

export const createCollabRepo = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { repoName } = req.body;

    const collab = await Collab.findById(collabId);
    if (!collab) return res.status(404).json({ message: "Collab not found" });

    const user = await User.findById(req.user._id);
    if (!user.githubAccessToken) {
      return res.status(400).json({ message: "Connect your GitHub account first." });
    }

    const octokit = new Octokit({ auth: user.githubAccessToken });

    const otherId = collab.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );
    const otherUser = await User.findById(otherId);

    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: `SkillSwap Collab Repo`,
      private: false,
      auto_init: true,
    });

    if (otherUser?.githubUsername) {
      await octokit.repos.addCollaborator({
        owner: user.githubUsername,
        repo: repoName,
        username: otherUser.githubUsername,
        permission: "push",
      });
    }

    collab.githubOwner = req.user._id;
    collab.githubRepoName = repoName;
    collab.githubRepoUrl = repo.html_url;
    await collab.save();

    res.json({ repoUrl: repo.html_url, repoName });
  } catch (err) {
    console.error("createCollabRepo error:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
  }
};

export const getRepoFiles = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { path = "" } = req.query;

    const collab = await Collab.findById(collabId);
    if (!collab || !collab.githubRepoName) {
      return res.status(400).json({ message: "No GitHub repo linked to this collab." });
    }

    const owner = await User.findById(collab.githubOwner);
    const octokit = new Octokit({ auth: owner.githubAccessToken });

    const { data } = await octokit.repos.getContent({
      owner: owner.githubUsername,
      repo: collab.githubRepoName,
      path,
    });

    res.json(data);
  } catch (err) {
    console.error("getRepoFiles error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getFileContent = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { path } = req.query;

    const collab = await Collab.findById(collabId);
    const owner = await User.findById(collab.githubOwner);
    const octokit = new Octokit({ auth: owner.githubAccessToken });

    const { data } = await octokit.repos.getContent({
      owner: owner.githubUsername,
      repo: collab.githubRepoName,
      path,
    });

    const content = Buffer.from(data.content, "base64").toString("utf-8");
    res.json({ content, sha: data.sha, path: data.path });
  } catch (err) {
    console.error("getFileContent error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const commitFile = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { path, content, message, sha } = req.body;

    const collab = await Collab.findById(collabId);
    const owner = await User.findById(collab.githubOwner);
    const octokit = new Octokit({ auth: owner.githubAccessToken });

    const encodedContent = Buffer.from(content).toString("base64");

    const payload = {
      owner: owner.githubUsername,
      repo: collab.githubRepoName,
      path,
      message: message || `Update ${path} via SkillSwap Collab`,
      content: encodedContent,
    };
    if (sha) payload.sha = sha;

    const { data } = await octokit.repos.createOrUpdateFileContents(payload);
    res.json({ commit: data.commit, content: data.content });
  } catch (err) {
    console.error("commitFile error:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
  }
};