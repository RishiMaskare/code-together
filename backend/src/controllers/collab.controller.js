import Collab from "../models/Collab.js";
import User from "../models/User.js";
import { Octokit } from "@octokit/rest";
import { onlineUsers } from "../lib/collab.socket.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Collab lifecycle ─────────────────────────────────────────────────────────

export const sendCollabRequest = async (req, res) => {
  try {
    const { friendId } = req.params;
    const myId = req.user._id;
    const me = await User.findById(myId);
    if (!me.friends.includes(friendId))
      return res.status(400).json({ message: "You can only collab with friends." });

    const existing = await Collab.findOne({
      participants: { $all: [myId, friendId] },
      status: { $in: ["pending", "active"] },
    });
    if (existing)
      return res.status(400).json({ message: "A collab already exists between you two." });

    const collab = await Collab.create({ participants: [myId, friendId], requester: myId, status: "pending" });
    await collab.populate("participants", "-password -githubAccessToken");

    const io = req.app.get("io");
    const socketId = onlineUsers.get(friendId.toString());
    if (io && socketId) {
      io.to(socketId).emit("collab:new_request", {
        collab,
        requester: collab.participants.find(p => p._id.toString() === myId.toString()),
      });
    }
    res.status(201).json(collab);
  } catch (err) {
    console.error("sendCollabRequest:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const acceptCollabRequest = async (req, res) => {
  try {
    const { collabId } = req.params;
    const collab = await Collab.findById(collabId);
    if (!collab) return res.status(404).json({ message: "Collab not found" });
    if (!collab.participants.map(String).includes(req.user._id.toString()))
      return res.status(403).json({ message: "Not authorized" });

    collab.status = "active";
    await collab.save();
    await collab.populate("participants", "-password -githubAccessToken");

    const io = req.app.get("io");
    const socketId = onlineUsers.get(collab.requester.toString());
    if (io && socketId) io.to(socketId).emit("collab:request_accepted", { collab });

    res.json(collab);
  } catch (err) {
    console.error("acceptCollabRequest:", err);
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

    const io = req.app.get("io");
    const socketId = onlineUsers.get(collab.requester.toString());
    if (io && socketId) io.to(socketId).emit("collab:request_rejected", { collabId: collab._id });

    res.json({ message: "Rejected" });
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
    const collab = await Collab.findById(req.params.collabId)
      .populate("participants", "-password -githubAccessToken");
    if (!collab) return res.status(404).json({ message: "Collab not found" });
    res.json(collab);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GitHub OAuth callback ────────────────────────────────────────────────────
// No protectRoute — GitHub redirects here directly.
// We pass userId inside OAuth state as "collabId:userId"

export const githubOAuthCallback = async (req, res) => {
  const { code, state } = req.query;
  const [collabId, userId] = (state || ":").split(":");

  try {
    if (!collabId || !userId) {
      return res.redirect(`${process.env.FRONTEND_URL}?github=error&msg=invalid_state`);
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("GitHub token error:", tokenData);
      return res.redirect(
        `${process.env.FRONTEND_URL}/collab/${collabId}?github=error&msg=${tokenData.error}`
      );
    }

    const octokit = new Octokit({ auth: tokenData.access_token });
    const { data: ghUser } = await octokit.users.getAuthenticated();

    await User.findByIdAndUpdate(userId, {
      githubAccessToken: tokenData.access_token,
      githubUsername: ghUser.login,
    });

    // Notify collab room to refresh
    const io = req.app.get("io");
    if (io) io.to(`collab:${collabId}`).emit("collab:updated");

    res.redirect(`${process.env.FRONTEND_URL}/collab/${collabId}?github=connected`);
  } catch (err) {
    console.error("githubOAuthCallback:", err);
    res.redirect(
      `${process.env.FRONTEND_URL}/collab/${collabId || ""}?github=error&msg=server_error`
    );
  }
};

export const disconnectGithub = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { githubAccessToken: null, githubUsername: null });
    res.json({ message: "GitHub disconnected" });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
};

// ─── Create repo + push local files + auto-invite partner ─────────────────────

export const createCollabRepo = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { repoName, localFiles = [] } = req.body;
    // localFiles: [{ path: "main.js", content: "..." }, ...]

    const collab = await Collab.findById(collabId);
    if (!collab) return res.status(404).json({ message: "Collab not found" });

    const user = await User.findById(req.user._id);
    if (!user.githubAccessToken)
      return res.status(400).json({ message: "Connect your GitHub account first." });

    const octokit = new Octokit({ auth: user.githubAccessToken });

    // 1. Create repo with auto_init (creates a default README)
    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: "KaushalX Collab Repo",
      private: false,
      auto_init: true,
    });

    // 2. Get the SHA of the initial README commit (needed for tree API)
    const { data: refData } = await octokit.git.getRef({
      owner: user.githubUsername,
      repo: repoName,
      ref: "heads/main",
    });
    const latestCommitSha = refData.object.sha;

    // 3. Get the base tree SHA
    const { data: commitData } = await octokit.git.getCommit({
      owner: user.githubUsername,
      repo: repoName,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // 4. Push all local files in one commit using Git Tree API
    if (localFiles.length > 0) {
      // Create blobs for each file
      const blobs = await Promise.all(
        localFiles.map(async (f) => {
          const { data: blob } = await octokit.git.createBlob({
            owner: user.githubUsername,
            repo: repoName,
            content: Buffer.from(f.content).toString("base64"),
            encoding: "base64",
          });
          return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
        })
      );

      // Create tree
      const { data: tree } = await octokit.git.createTree({
        owner: user.githubUsername,
        repo: repoName,
        base_tree: baseTreeSha,
        tree: blobs,
      });

      // Create commit
      const { data: newCommit } = await octokit.git.createCommit({
        owner: user.githubUsername,
        repo: repoName,
        message: "Initial collab files via KaushalX",
        tree: tree.sha,
        parents: [latestCommitSha],
      });

      // Update ref
      await octokit.git.updateRef({
        owner: user.githubUsername,
        repo: repoName,
        ref: "heads/main",
        sha: newCommit.sha,
      });
    }

    // 5. Find the other participant and invite them
    const otherId = collab.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );
    const otherUser = await User.findById(otherId);

    if (otherUser?.githubUsername) {
      try {
        await octokit.repos.addCollaborator({
          owner: user.githubUsername,
          repo: repoName,
          username: otherUser.githubUsername,
          permission: "push",
        });
        console.log(`✅ Invited ${otherUser.githubUsername} as collaborator`);
      } catch (e) {
        // Non-fatal — partner can still see files even without collaborator access
        console.warn("Could not add collaborator:", e.message);
      }
    } else {
      console.log("Partner has no GitHub connected — skipping collaborator invite");
    }

    // 6. Save repo info to collab
    collab.githubOwner = req.user._id;
    collab.githubRepoName = repoName;
    collab.githubRepoUrl = repo.html_url;
    await collab.save();

    // 7. Notify both users to refresh
    const io = req.app.get("io");
    if (io) io.to(`collab:${collabId}`).emit("collab:updated");

    res.json({ repoUrl: repo.html_url, repoName });
  } catch (err) {
    console.error("createCollabRepo:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
  }
};

// ─── Repo file operations ─────────────────────────────────────────────────────

export const getRepoFiles = async (req, res) => {
  try {
    const { collabId } = req.params;
    const { path = "" } = req.query;
    const collab = await Collab.findById(collabId);
    if (!collab?.githubRepoName)
      return res.status(400).json({ message: "No repo linked." });

    const owner = await User.findById(collab.githubOwner);
    const octokit = new Octokit({ auth: owner.githubAccessToken });
    const { data } = await octokit.repos.getContent({
      owner: owner.githubUsername,
      repo: collab.githubRepoName,
      path,
    });
    res.json(data);
  } catch (err) {
    console.error("getRepoFiles:", err);
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
    res.json({
      content: Buffer.from(data.content, "base64").toString("utf-8"),
      sha: data.sha,
      path: data.path,
    });
  } catch (err) {
    console.error("getFileContent:", err);
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

    const payload = {
      owner: owner.githubUsername,
      repo: collab.githubRepoName,
      path,
      message: message || `Update ${path} via KaushalX`,
      content: Buffer.from(content).toString("base64"),
    };
    if (sha) payload.sha = sha;

    const { data } = await octokit.repos.createOrUpdateFileContents(payload);
    res.json({ commit: data.commit, content: data.content });
  } catch (err) {
    console.error("commitFile:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
  }
};

// ─── Code Execution via Judge0 CE (free public instance) ─────────────────────

const JUDGE0_URL = "https://ce.judge0.com";

const JUDGE0_LANG_IDS = {
  python:     71,
  javascript: 63,
  typescript: 74,
  java:       62,
  cpp:        54,
  c:          50,
  go:         60,
  rust:       73,
};

const toB64 = (s) => Buffer.from(String(s ?? ""), "utf8").toString("base64");
const fromB64 = (s) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

export const executeCode = async (req, res) => {
  const { language, code, stdin } = req.body;

  if (!language || !code) {
    return res.status(400).json({ error: "language and code are required" });
  }

  const langId = JUDGE0_LANG_IDS[language];
  if (!langId) {
    return res.status(400).json({ error: `Language "${language}" is not supported.` });
  }

  try {
    // base64_encoded=true avoids the "cannot be converted to UTF-8" 400 error
    // that the public Judge0 CE instance returns for certain code snippets.
    const submitRes = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language_id: langId,
        source_code: toB64(code),
        stdin: toB64(stdin || ""),
      }),
    });

    if (!submitRes.ok) {
      // Surface Judge0's real reason instead of a bare status code.
      let reason = "";
      try {
        const errBody = await submitRes.json();
        reason = errBody.error || errBody.message || JSON.stringify(errBody);
      } catch {
        reason = await submitRes.text().catch(() => "");
      }
      console.error("[exec] Judge0 submit failed:", submitRes.status, reason);
      return res.status(502).json({
        error: `Execution failed (Judge0 ${submitRes.status}): ${reason || "unknown error"}`,
      });
    }

    const result = await submitRes.json();

    return res.json({
      stdout:         fromB64(result.stdout),
      stderr:         fromB64(result.stderr),
      compile_stderr: fromB64(result.compile_output),
      message:        fromB64(result.message),
      exit_code:      result.exit_code,
      time:           result.time            || "",
      memory:         result.memory          || "",
      status:         result.status?.description || "",
      status_id:      result.status?.id ?? null,
      via:            JUDGE0_URL,
    });
  } catch (e) {
    console.error("[exec] executeCode error:", e.message);
    return res.status(502).json({
      error: `Execution failed: ${e.message}`,
    });
  }
};

// Add this to collab.controller.js
export const sendTeamCollabRequest = async (req, res) => {
  try {
    const { friendIds, teamName } = req.body;
    const myId = req.user._id;

    // Verify you are inviting friends
    const me = await User.findById(myId);
    const allAreFriends = friendIds.every(id => me.friends.includes(id));
    if (!allAreFriends) return res.status(400).json({ message: "You can only invite friends." });

    const participants = [myId, ...friendIds];

    const collab = await Collab.create({
      type: "team",
      teamName: teamName || "Team Project",
      participants,
      requester: myId,
      status: "pending"
    });

    await collab.populate("participants", "-password -githubAccessToken");

    // Send socket notification to ALL invited friends
    const io = req.app.get("io");
    if (io) {
      friendIds.forEach(friendId => {
        const socketId = onlineUsers.get(friendId.toString());
        if (socketId) {
          io.to(socketId).emit("collab:new_request", {
            collab,
            requester: collab.participants.find(p => p._id.toString() === myId.toString()),
          });
        }
      });
    }

    res.status(201).json(collab);
  } catch (err) {
    console.error("sendTeamCollabRequest:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ─── AI Code Assistant ────────────────────────────────────────────────────────

export const askCodeAssistant = async (req, res) => {
  try {
    const { question, code, language, output } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key is missing. Please check your .env file." });
    }

    // Initialize inside the function to avoid startup crashes if .env loads late
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // "gemini-flash-latest" is Google's rolling alias to the latest stable Flash model.
    // (The previously hardcoded "gemini-2.5-flash" now returns 404 for new keys.)
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `
      You are an expert coding assistant helping a user inside a collaborative code editor.
      
      Context:
      - Language: ${language || "Unknown"}
      - Current Code: 
      \`\`\`${language || "text"}
      ${code || "// No code written yet"}
      \`\`\`
      - Recent Console/Execution Output: 
      ${output || "No recent output."}
      
      User Question: ${question}
      
      Please provide a helpful, concise, and accurate answer. If the user is asking about an error, explain why it happened and how to fix it. Keep your formatting clean (using markdown) so it looks good in a chat window.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    res.status(200).json({ answer: responseText });

  } catch (error) {
    console.error("AI Assistant Error:", error);
    const reason = error?.message || "Unknown error";
    res.status(500).json({ error: `Failed to communicate with the AI assistant: ${reason}` });
  }
};