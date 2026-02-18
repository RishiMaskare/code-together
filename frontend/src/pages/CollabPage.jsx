import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import {
  FolderIcon,
  FileIcon,
  GitBranchIcon,
  SaveIcon,
  MonitorIcon,
  MonitorOffIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  LinkIcon,
} from "lucide-react";

import {
  getCollabById,
  createCollabRepo,
  getRepoFiles,
  getFileContent,
  commitFile,
} from "../lib/collab.api";
import useAuthUser from "../hooks/useAuthUser.js";
import useSocket from "../hooks/useSocket.js";

// ── File Tree Node ─────────────────────────────────────────────────────────────
const FileTreeNode = ({ item, collabId, onSelectFile, selectedPath }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  const isDir = item.type === "dir";
  const isSelected = selectedPath === item.path;

  const handleClick = async () => {
    if (isDir) {
      setExpanded((prev) => !prev);
      if (!expanded && children.length === 0) {
        setLoading(true);
        try {
          const data = await getRepoFiles(collabId, item.path);
          setChildren(Array.isArray(data) ? data : []);
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      }
    } else {
      onSelectFile(item.path);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-sm transition-colors ${
          isSelected ? "bg-primary text-primary-content" : "hover:bg-base-300"
        }`}
        onClick={handleClick}
      >
        {isDir ? (
          expanded ? (
            <ChevronDownIcon className="size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" />
          )
        ) : null}
        {isDir ? (
          <FolderIcon className="size-3.5 shrink-0 text-yellow-500" />
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-blue-400" />
        )}
        <span className="truncate">{item.name}</span>
      </div>
      {isDir && expanded && (
        <div className="ml-4">
          {loading ? (
            <span className="loading loading-spinner loading-xs ml-2" />
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.sha}
                item={child}
                collabId={collabId}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ── Main CollabPage ────────────────────────────────────────────────────────────
const CollabPage = () => {
  const { collabId } = useParams();
  const navigate = useNavigate();
  const { authUser } = useAuthUser();
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const editorRef = useRef(null);

  // Editor state
  const [editorContent, setEditorContent] = useState("// Select a file to start editing");
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileSha, setFileSha] = useState(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Root file tree
  const [rootFiles, setRootFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // GitHub repo setup
  const [repoName, setRepoName] = useState("");
  const [showRepoModal, setShowRepoModal] = useState(false);

  // Screen share state
  const [shareActive, setShareActive] = useState(false);
  const [viewingFrom, setViewingFrom] = useState(null);
  const [incomingShareFrom, setIncomingShareFrom] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Fetch collab ─────────────────────────────────────────────────────────────
  const { data: collab, isLoading: loadingCollab } = useQuery({
    queryKey: ["collab", collabId],
    queryFn: () => getCollabById(collabId),
  });

  // Safely derive partner and ownership
  const partner = collab?.participants?.find(
    (p) => String(p._id || p) !== String(authUser?._id)
  );

  const amIOwner = String(collab?.githubOwner) === String(authUser?._id);

  // ── GitHub OAuth connect ──────────────────────────────────────────────────────
  const connectGithub = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    const backendUrl =
      import.meta.env.MODE === "development"
        ? "http://localhost:5001"
        : "";
    const redirectUri = `${backendUrl}/api/collab/github/callback`;
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&state=${collabId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  // ── Create Repo ───────────────────────────────────────────────────────────────
  const { mutate: doCreateRepo, isPending: creatingRepo } = useMutation({
    mutationFn: () => createCollabRepo(collabId, repoName),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["collab", collabId] });
      showToast(`Repo "${data.repoName}" created!`, "success");
      setShowRepoModal(false);
      loadRootFiles();
    },
    onError: (err) => showToast(err?.response?.data?.message || err.message, "error"),
  });

  // ── Commit ────────────────────────────────────────────────────────────────────
  const { mutate: doCommit, isPending: committing } = useMutation({
    mutationFn: () =>
      commitFile(collabId, {
        path: selectedFile,
        content: editorContent,
        message: commitMessage || `Update ${selectedFile}`,
        sha: fileSha,
      }),
    onSuccess: (data) => {
      setIsDirty(false);
      setFileSha(data.content.sha);
      setShowCommitModal(false);
      setCommitMessage("");
      showToast("Committed successfully!", "success");
      socket?.emit("collab:committed", {
        collabId,
        filePath: selectedFile,
        message: commitMessage,
        userId: authUser._id,
      });
    },
    onError: (err) => showToast(err?.response?.data?.message || err.message, "error"),
  });

  // ── Load root files ───────────────────────────────────────────────────────────
  const loadRootFiles = useCallback(async () => {
    if (!collab?.githubRepoName) return;
    setLoadingFiles(true);
    try {
      const data = await getRepoFiles(collabId, "");
      setRootFiles(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast("Failed to load repo files", "error", e);
    } finally {
      setLoadingFiles(false);
    }
  }, [collab?.githubRepoName, collabId, showToast]);

  useEffect(() => {
    if (collab?.githubRepoName) loadRootFiles();
  }, [collab?.githubRepoName, loadRootFiles]);

  // ── Select file ───────────────────────────────────────────────────────────────
  const handleSelectFile = useCallback(
    async (path) => {
      try {
        const { content, sha } = await getFileContent(collabId, path);
        setEditorContent(content);
        setFileSha(sha);
        setSelectedFile(path);
        setIsDirty(false);
        socket?.emit("collab:file_selected", {
          collabId,
          filePath: path,
          userId: authUser?._id,
        });
      } catch (e) {
        showToast("Failed to load file", "error", e);
      }
    },
    [collabId, socket, authUser?._id, showToast]
  );

  // ── Socket setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !authUser?._id) return;

    socket.emit("collab:join", { collabId, userId: authUser._id });

    const handleEditorChange = ({ content, filePath, userId }) => {
      if (viewingFrom === userId || selectedFile === filePath) {
        setEditorContent(content);
      }
    };

    const handleFileSelected = ({ filePath, userId }) => {
      if (viewingFrom === userId) {
        handleSelectFile(filePath);
      }
    };

    const handleShareRequest = ({ fromUserId, toUserId }) => {
      if (toUserId === authUser._id) {
        setIncomingShareFrom(fromUserId);
      }
    };

    const handleShareAccepted = ({ viewerUserId }) => {
      if (viewerUserId !== authUser._id) {
        setShareActive(true);
        showToast(`${partner?.fullName || "Partner"} is now viewing your editor`, "info");
      }
    };

    const handleShareRejected = () => {
      showToast("Share request was declined", "info");
    };

    const handleShareRevoked = () => {
      setViewingFrom(null);
      showToast("Screen share ended", "info");
    };

    const handleCommitted = ({ message, userId }) => {
      if (userId !== authUser._id) {
        showToast(`Partner committed: "${message}"`, "success");
      }
    };

    socket.on("collab:editor_change", handleEditorChange);
    socket.on("collab:file_selected", handleFileSelected);
    socket.on("collab:share_request", handleShareRequest);
    socket.on("collab:share_accepted", handleShareAccepted);
    socket.on("collab:share_rejected", handleShareRejected);
    socket.on("collab:share_revoked", handleShareRevoked);
    socket.on("collab:committed", handleCommitted);

    return () => {
      socket.emit("collab:leave", { collabId, userId: authUser._id });
      socket.off("collab:editor_change", handleEditorChange);
      socket.off("collab:file_selected", handleFileSelected);
      socket.off("collab:share_request", handleShareRequest);
      socket.off("collab:share_accepted", handleShareAccepted);
      socket.off("collab:share_rejected", handleShareRejected);
      socket.off("collab:share_revoked", handleShareRevoked);
      socket.off("collab:committed", handleCommitted);
    };
  }, [socket, authUser?._id, collabId, viewingFrom, selectedFile, partner?.fullName, handleSelectFile, showToast]);

  // ── Editor change handler ─────────────────────────────────────────────────────
  const handleEditorChange = (value) => {
    setEditorContent(value || "");
    setIsDirty(true);
    if (!viewingFrom) {
      socket?.emit("collab:editor_change", {
        collabId,
        content: value,
        filePath: selectedFile,
        userId: authUser?._id,
      });
    }
  };

  // ── Screen share ──────────────────────────────────────────────────────────────
  const requestShare = () => {
    socket?.emit("collab:share_request", {
      collabId,
      fromUserId: authUser._id,
      toUserId: partner?._id,
    });
    showToast("Share request sent, waiting for partner...", "info");
  };

  const acceptShare = () => {
    setViewingFrom(incomingShareFrom);
    setIncomingShareFrom(null);
    socket?.emit("collab:share_accepted", { collabId, viewerUserId: authUser._id });
    showToast("You are now viewing your partner's editor live", "success");
  };

  const rejectShare = () => {
    setIncomingShareFrom(null);
    socket?.emit("collab:share_rejected", { collabId, viewerUserId: authUser._id });
  };

  const revokeShare = () => {
    setShareActive(false);
    socket?.emit("collab:share_revoked", { collabId });
    showToast("Screen share ended", "info");
  };

  const stopViewing = () => {
    setViewingFrom(null);
    showToast("Stopped viewing partner's editor", "info");
  };

  // ── Language detection for Monaco ─────────────────────────────────────────────
  const getLanguage = (filePath) => {
    if (!filePath) return "plaintext";
    const ext = filePath.split(".").pop().toLowerCase();
    const map = {
      js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
      py: "python", java: "java", cpp: "cpp", c: "c", cs: "csharp",
      html: "html", css: "css", json: "json", md: "markdown",
      yaml: "yaml", yml: "yaml", sh: "shell", go: "go", rs: "rust",
    };
    return map[ext] || "plaintext";
  };

  // ── Render guards ─────────────────────────────────────────────────────────────
  if (loadingCollab) {
    return (
      <div className="flex justify-center items-center h-screen">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (!collab) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>Collab not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Toast ── */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 alert shadow-lg max-w-sm ${
            toast.type === "success"
              ? "alert-success"
              : toast.type === "error"
              ? "alert-error"
              : "alert-info"
          }`}
        >
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── Incoming Share Request Modal ── */}
      {incomingShareFrom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg">Editor Share Request</h3>
            <p className="text-sm opacity-70">
              Your partner wants to share their editor with you. You will be able to
              see their code in real time.
            </p>
            <div className="flex gap-3">
              <button className="btn btn-success flex-1" onClick={acceptShare}>
                <CheckCircleIcon className="size-4 mr-1" /> Accept
              </button>
              <button className="btn btn-error btn-outline flex-1" onClick={rejectShare}>
                <XCircleIcon className="size-4 mr-1" /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Commit Modal ── */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <GitBranchIcon className="size-5" />
              Commit Changes
            </h3>
            <p className="text-sm opacity-60 truncate">File: {selectedFile}</p>
            <input
              className="input input-bordered w-full"
              placeholder="Commit message..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                className="btn btn-primary flex-1"
                onClick={() => doCommit()}
                disabled={committing}
              >
                {committing ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <>
                    <SaveIcon className="size-4 mr-1" /> Commit & Push
                  </>
                )}
              </button>
              <button
                className="btn btn-ghost flex-1"
                onClick={() => setShowCommitModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Repo Modal ── */}
      {showRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <GitBranchIcon className="size-5" />
              Create GitHub Repo
            </h3>
            <input
              className="input input-bordered w-full"
              placeholder="Repository name (no spaces)..."
              value={repoName}
              onChange={(e) => setRepoName(e.target.value.replace(/\s+/g, "-"))}
            />
            <div className="flex gap-3">
              <button
                className="btn btn-primary flex-1"
                onClick={() => doCreateRepo()}
                disabled={creatingRepo || !repoName.trim()}
              >
                {creatingRepo ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  "Create"
                )}
              </button>
              <button
                className="btn btn-ghost flex-1"
                onClick={() => setShowRepoModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/collab")}>
            ← Back
          </button>
          <div className="flex items-center gap-2">
            <div className="avatar">
              <div className="w-8 rounded-full">
                <img src={partner?.profilePic || "/avatar.png"} alt={partner?.fullName || "Partner"} />
              </div>
            </div>
            <span className="font-semibold text-sm">{partner?.fullName || "Partner"}</span>
          </div>
          {collab.githubRepoUrl && (
            <a
              href={collab.githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="badge badge-outline badge-sm gap-1 text-primary"
            >
              <LinkIcon className="size-3" />
              {collab.githubRepoName}
            </a>
          )}
        </div>

        <div className="flex items-center gap-2">
          {viewingFrom ? (
            <button className="btn btn-warning btn-sm" onClick={stopViewing}>
              <MonitorOffIcon className="size-4 mr-1" />
              Stop Viewing
            </button>
          ) : shareActive ? (
            <button className="btn btn-warning btn-sm" onClick={revokeShare}>
              <MonitorOffIcon className="size-4 mr-1" />
              Stop Sharing
            </button>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={requestShare}>
              <MonitorIcon className="size-4 mr-1" />
              Share Editor
            </button>
          )}

          {selectedFile && !viewingFrom && (
            <button
              className={`btn btn-sm ${isDirty ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setShowCommitModal(true)}
              disabled={!isDirty}
            >
              <SaveIcon className="size-4 mr-1" />
              Commit
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: File Tree ── */}
        <div className="w-60 shrink-0 bg-base-200 border-r border-base-300 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-base-300 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
              Files
            </span>
            {collab.githubRepoName && (
              <button className="btn btn-ghost btn-xs" onClick={loadRootFiles}>
                <RefreshCwIcon className="size-3" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {!authUser?.githubUsername ? (
              <div className="space-y-2 p-2 text-center">
                <p className="text-xs opacity-60">Connect GitHub to access files</p>
                <button className="btn btn-outline btn-xs w-full" onClick={connectGithub}>
                  Connect GitHub
                </button>
              </div>
            ) : !collab.githubRepoName ? (
              <div className="space-y-2 p-2 text-center">
                <p className="text-xs opacity-60">No repo linked yet</p>
                {amIOwner || !collab.githubOwner ? (
                  <button
                    className="btn btn-outline btn-xs w-full"
                    onClick={() => setShowRepoModal(true)}
                  >
                    Create Repo
                  </button>
                ) : (
                  <p className="text-xs opacity-40">Waiting for partner to create repo...</p>
                )}
              </div>
            ) : loadingFiles ? (
              <div className="flex justify-center pt-4">
                <span className="loading loading-spinner loading-sm" />
              </div>
            ) : rootFiles.length === 0 ? (
              <div className="text-center p-2">
                <p className="text-xs opacity-40">No files found</p>
                <button className="btn btn-ghost btn-xs mt-2" onClick={loadRootFiles}>
                  Refresh
                </button>
              </div>
            ) : (
              rootFiles.map((item) => (
                <FileTreeNode
                  key={item.sha}
                  item={item}
                  collabId={collabId}
                  onSelectFile={handleSelectFile}
                  selectedPath={selectedFile}
                />
              ))
            )}
          </div>

          {authUser?.githubUsername && (
            <div className="border-t border-base-300 p-2 text-xs text-center opacity-50">
              @{authUser.githubUsername}
            </div>
          )}
        </div>

        {/* ── Center: Monaco Editor ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-base-100 border-b border-base-300 text-xs shrink-0">
            {selectedFile ? (
              <>
                <FileIcon className="size-3" />
                <span className="opacity-70">{selectedFile}</span>
                {isDirty && <span className="text-warning ml-1">●</span>}
              </>
            ) : (
              <span className="opacity-40">No file selected</span>
            )}
            {viewingFrom && (
              <span className="ml-auto badge badge-warning badge-sm">
                👁 Viewing Partner's Editor (Live)
              </span>
            )}
            {shareActive && (
              <span className="ml-auto badge badge-info badge-sm">
                📡 Sharing Your Editor
              </span>
            )}
          </div>

          <div className="flex-1">
            <Editor
              height="100%"
              language={getLanguage(selectedFile)}
              value={editorContent}
              onChange={handleEditorChange}
              onMount={(editor) => (editorRef.current = editor)}
              theme="vs-dark"
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                wordWrap: "on",
                tabSize: 2,
                scrollBeyondLastLine: false,
                readOnly: !!viewingFrom,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollabPage;