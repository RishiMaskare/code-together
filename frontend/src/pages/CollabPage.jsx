import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import {
  FolderIcon, FileIcon, GitBranchIcon, SaveIcon,
  MonitorIcon, MonitorOffIcon, CheckCircleIcon, XCircleIcon,
  ChevronRightIcon, ChevronDownIcon, RefreshCwIcon, LinkIcon,
  GitCommitIcon, PlayIcon, FilePlusIcon, Trash2Icon, PencilIcon,
  SparklesIcon, BookOpenIcon
} from "lucide-react";

import {
  getCollabById, createCollabRepo, getRepoFiles,
  getFileContent, commitFile,
} from "../lib/collab.api";
import useAuthUser from "../hooks/useAuthUser.js";
import useSocket from "../hooks/useSocket.js";
import { formatExecutionResult } from "../lib/utils.js";
import MeetingFeature from "../features/meeting/MeetingFeature.jsx";

// ── Language config (Judge0 IDs + Docs) ──────────────────────────────────────────────
const LANGS = {
  javascript: { id: 63,  name: "JavaScript", ext: ".js",   template: "// JavaScript\nconsole.log('Hello, World!');", docs: [{ name: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" }, { name: "W3Schools", url: "https://www.w3schools.com/js/" }] },
  typescript: { id: 74,  name: "TypeScript", ext: ".ts",   template: "const msg: string = 'Hello, World!';\nconsole.log(msg);", docs: [{ name: "TS Docs", url: "https://www.typescriptlang.org/docs/" }] },
  python:     { id: 71,  name: "Python",     ext: ".py",   template: "# Python\nprint('Hello, World!')", docs: [{ name: "Python Docs", url: "https://docs.python.org/3/" }, { name: "GeeksforGeeks", url: "https://www.geeksforgeeks.org/python-programming-language/" }] },
  java:       { id: 62,  name: "Java",       ext: ".java", template: "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello, World!\");\n  }\n}", docs: [{ name: "Oracle Docs", url: "https://docs.oracle.com/en/java/" }, { name: "GeeksforGeeks", url: "https://www.geeksforgeeks.org/java/" }] },
  cpp:        { id: 54,  name: "C++",        ext: ".cpp",  template: "#include<iostream>\nusing namespace std;\nint main(){\n  cout<<\"Hello, World!\"<<endl;\n  return 0;\n}", docs: [{ name: "cplusplus.com", url: "https://cplusplus.com/doc/tutorial/" }, { name: "W3Schools", url: "https://www.w3schools.com/cpp/" }] },
  c:          { id: 50,  name: "C",          ext: ".c",    template: "#include<stdio.h>\nint main(){\n  printf(\"Hello, World!\\n\");\n  return 0;\n}", docs: [{ name: "GeeksforGeeks", url: "https://www.geeksforgeeks.org/c-programming-language/" }] },
  go:         { id: 60,  name: "Go",         ext: ".go",   template: "package main\nimport \"fmt\"\nfunc main(){\n  fmt.Println(\"Hello, World!\")\n}", docs: [{ name: "Go Docs", url: "https://go.dev/doc/" }, { name: "W3Schools", url: "https://www.w3schools.com/go/" }] },
  rust:       { id: 73,  name: "Rust",       ext: ".rs",   template: "fn main(){\n  println!(\"Hello, World!\");\n}", docs: [{ name: "Rust Book", url: "https://doc.rust-lang.org/book/" }] },
};

const extToLang = (path) => {
  if (!path) return "javascript";
  const ext = "." + path.split(".").pop().toLowerCase();
  const found = Object.entries(LANGS).find(([, v]) => v.ext === ext);
  return found ? found[0] : "plaintext";
};

// ── Local file tree builder ───────────────────────────────────────────────────
const buildTree = (files) => {
  const root = [];
  files.forEach(f => {
    const parts = f.path.split("/");
    let nodes = root;
    let cur = "";
    parts.forEach((part, i) => {
      cur = cur ? `${cur}/${part}` : part;
      let node = nodes.find(n => n.name === part);
      if (!node) {
        node = { name: part, path: cur, type: i === parts.length - 1 ? "file" : "dir", children: [] };
        nodes.push(node);
      }
      nodes = node.children;
    });
  });
  return root;
};

// ── Local file node ───────────────────────────────────────────────────────────
const LocalNode = ({ node, depth = 0, onSelect, selectedPath, onDelete, onRename }) => {
  const [open, setOpen] = useState(true);
  const isDir = node.type === "dir";
  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-1 rounded cursor-pointer text-sm transition-colors ${
          selectedPath === node.path ? "bg-primary text-primary-content" : "hover:bg-base-300"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "8px" }}
        onClick={() => isDir ? setOpen(p => !p) : onSelect(node)}
      >
        {isDir
          ? open ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />
          : <span className="size-3 shrink-0" />}
        {isDir
          ? <FolderIcon className="size-3.5 shrink-0 text-yellow-500" />
          : <FileIcon className="size-3.5 shrink-0 text-blue-400" />}
        <span className="truncate flex-1 text-xs">{node.name}</span>
        {!isDir && (
          <div className="hidden group-hover:flex gap-0.5">
            <button onClick={e => { e.stopPropagation(); onRename(node); }}
              className="btn btn-ghost btn-xs p-0 h-4 w-4 min-h-0">
              <PencilIcon className="size-2.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(node.path); }}
              className="btn btn-ghost btn-xs p-0 h-4 w-4 min-h-0 text-error">
              <Trash2Icon className="size-2.5" />
            </button>
          </div>
        )}
      </div>
      {isDir && open && node.children.map(c =>
        <LocalNode key={c.path} node={c} depth={depth + 1}
          onSelect={onSelect} selectedPath={selectedPath}
          onDelete={onDelete} onRename={onRename} />
      )}
    </div>
  );
};

// ── GitHub file node ──────────────────────────────────────────────────────────
const GhNode = ({ item, collabId, onSelect, selectedPath }) => {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState([]);
  const [loading, setLoading] = useState(false);
  const isDir = item.type === "dir";
  const click = async () => {
    if (isDir) {
      setOpen(p => !p);
      if (!open && kids.length === 0) {
        setLoading(true);
        try { setKids((await getRepoFiles(collabId, item.path)) || []); } finally { setLoading(false); }
      }
    } else onSelect(item.path);
  };
  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
          selectedPath === item.path ? "bg-primary text-primary-content" : "hover:bg-base-300"
        }`}
        onClick={click}
      >
        {isDir ? (open ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />) : <span className="size-3" />}
        {isDir ? <FolderIcon className="size-3.5 text-yellow-500 shrink-0" /> : <FileIcon className="size-3.5 text-blue-400 shrink-0" />}
        <span className="truncate">{item.name}</span>
      </div>
      {isDir && open && (
        <div className="ml-4">
          {loading ? <span className="loading loading-spinner loading-xs ml-2" />
            : kids.map(k => <GhNode key={k.sha} item={k} collabId={collabId} onSelect={onSelect} selectedPath={selectedPath} />)}
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const CollabPage = () => {
  const { collabId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { authUser } = useAuthUser();
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const editorRef = useRef(null);

  // mode: "local" = files not yet on GitHub, "github" = repo exists
  const [mode, setMode] = useState("local");

  // local files
  const [localFiles, setLocalFiles] = useState([
    { path: "main.js", content: LANGS.javascript.template },
  ]);

  // editor
  const [selectedFile, setSelectedFile] = useState("main.js");
  const [editorContent, setEditorContent] = useState(LANGS.javascript.template);
  const [fileSha, setFileSha] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lang, setLang] = useState("javascript");

  // github files
  const [rootFiles, setRootFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // code execution
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  // AI Assistant
  const [showAI, setShowAI] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  // commit
  const [commitMsg, setCommitMsg] = useState("");
  const [commitOk, setCommitOk] = useState(false);

  // modals
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileLang, setNewFileLang] = useState("javascript");
  const [renameTarget, setRenameTarget] = useState(null);
  const [repoName, setRepoName] = useState("");

  // screen share
  const [shareActive, setShareActive] = useState(false);
  const [viewingFrom, setViewingFrom] = useState(null);
  const [incomingShare, setIncomingShare] = useState(null);

  // toast
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── OAuth redirect handler ────────────────────────────────────────────────────
  useEffect(() => {
    const status = searchParams.get("github");
    if (status === "connected") {
      queryClient.invalidateQueries({ queryKey: ["authUser"] });
      queryClient.invalidateQueries({ queryKey: ["collab", collabId] });
      showToast("GitHub connected! Name your repo to push your files.", "success");
      setSearchParams({});
      setShowRepoModal(true);
    } else if (status === "error") {
      showToast(`GitHub error: ${searchParams.get("msg") || "unknown"}`, "error");
      setSearchParams({});
    }
  }, []); // eslint-disable-line

  // ── Fetch collab ──────────────────────────────────────────────────────────────
  const { data: collab, isLoading: loadingCollab } = useQuery({
    queryKey: ["collab", collabId],
    queryFn: () => getCollabById(collabId),
  });

  useEffect(() => { if (collab?.githubRepoName) setMode("github"); }, [collab?.githubRepoName]);

  const partner = collab?.participants?.find(p => String(p._id || p) !== String(authUser?._id));
  const amIOwner = String(collab?.githubOwner) === String(authUser?._id);

  // ── Connect GitHub ────────────────────────────────────────────────────────────
  const connectGithub = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    const base = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
    const redirect = `${base}/api/collab/github/callback`;
    window.location.replace(
      `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&state=${collabId}:${authUser._id}&redirect_uri=${encodeURIComponent(redirect)}`
    );
  };

  // ── Create repo (push all local files) ───────────────────────────────────────
  const { mutate: doCreateRepo, isPending: creatingRepo } = useMutation({
    mutationFn: () => createCollabRepo(collabId, repoName, localFiles),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["collab", collabId] });
      showToast(`Repo "${data.repoName}" created & partner invited!`, "success");
      setShowRepoModal(false);
      setRepoName("");
      setMode("github");
    },
    onError: (err) => showToast(err?.response?.data?.message || err.message, "error"),
  });

  // ── Commit file ───────────────────────────────────────────────────────────────
  const { mutate: doCommit, isPending: committing } = useMutation({
    mutationFn: () => commitFile(collabId, {
      path: selectedFile,
      content: editorContent,
      message: commitMsg.trim() || `Update ${selectedFile}`,
      sha: fileSha,
    }),
    onSuccess: (data) => {
      setIsDirty(false);
      setFileSha(data.content.sha);
      setCommitMsg("");
      setCommitOk(true);
      setTimeout(() => setCommitOk(false), 2500);
      showToast("Committed & pushed!", "success");
      socket?.emit("collab:committed", { collabId, filePath: selectedFile, message: commitMsg, userId: authUser._id });
    },
    onError: (err) => showToast(err?.response?.data?.message || err.message, "error"),
  });

  // ── Load GitHub root files ────────────────────────────────────────────────────
  const loadRootFiles = useCallback(async () => {
    if (!collab?.githubRepoName) return;
    setLoadingFiles(true);
    try { setRootFiles((await getRepoFiles(collabId, "")) || []); }
    catch { showToast("Failed to load repo files", "error"); }
    finally { setLoadingFiles(false); }
  }, [collab?.githubRepoName, collabId, showToast]);

  useEffect(() => { if (collab?.githubRepoName) loadRootFiles(); }, [collab?.githubRepoName, loadRootFiles]);

  // ── Select file from GitHub ───────────────────────────────────────────────────
  const selectGhFile = useCallback(async (path) => {
    try {
      const { content, sha } = await getFileContent(collabId, path);
      setEditorContent(content);
      setFileSha(sha);
      setSelectedFile(path);
      setLang(extToLang(path));
      setIsDirty(false);
      socket?.emit("collab:file_selected", { collabId, filePath: path, userId: authUser?._id });
    } catch { showToast("Failed to load file", "error"); }
  }, [collabId, socket, authUser?._id, showToast]);

  // ── Select local file ─────────────────────────────────────────────────────────
  const selectLocalFile = useCallback((node) => {
    const f = localFiles.find(f => f.path === node.path);
    if (!f) return;
    setEditorContent(f.content);
    setSelectedFile(node.path);
    setLang(extToLang(node.path));
    setIsDirty(false);
    socket?.emit("collab:file_selected", { collabId, filePath: node.path, userId: authUser?._id });
  }, [localFiles, collabId, socket, authUser?._id]);

  // ── Local file ops ────────────────────────────────────────────────────────────
  const createFile = () => {
    const ext = LANGS[newFileLang]?.ext || ".js";
    const name = newFileName.trim().includes(".") ? newFileName.trim() : newFileName.trim() + ext;
    if (!name || localFiles.find(f => f.path === name)) {
      showToast("Invalid or duplicate filename", "error"); return;
    }
    const content = LANGS[newFileLang]?.template || "";
    setLocalFiles(p => [...p, { path: name, content }]);
    setEditorContent(content);
    setSelectedFile(name);
    setLang(newFileLang);
    setShowNewFile(false);
    setNewFileName("");
    showToast(`Created ${name}`, "success");
  };

  const deleteFile = (path) => {
    const remaining = localFiles.filter(f => f.path !== path);
    setLocalFiles(remaining);
    if (selectedFile === path) {
      if (remaining.length > 0) {
        setEditorContent(remaining[0].content);
        setSelectedFile(remaining[0].path);
        setLang(extToLang(remaining[0].path));
      } else { setEditorContent(""); setSelectedFile(null); }
    }
    showToast(`Deleted ${path}`, "info");
  };

  const renameFile = () => {
    const newPath = newFileName.trim();
    if (!newPath || !renameTarget || localFiles.find(f => f.path === newPath)) {
      showToast("Invalid or duplicate name", "error"); return;
    }
    setLocalFiles(p => p.map(f => f.path === renameTarget.path ? { ...f, path: newPath } : f));
    if (selectedFile === renameTarget.path) { setSelectedFile(newPath); setLang(extToLang(newPath)); }
    setShowRename(false); setRenameTarget(null); setNewFileName("");
    showToast(`Renamed to ${newPath}`, "success");
  };

  // ── Editor change ─────────────────────────────────────────────────────────────
  const onEditorChange = (val) => {
    const v = val || "";
    setEditorContent(v);
    setIsDirty(true);
    if (mode === "local") setLocalFiles(p => p.map(f => f.path === selectedFile ? { ...f, content: v } : f));
    if (!viewingFrom) socket?.emit("collab:editor_change", { collabId, content: v, filePath: selectedFile, userId: authUser?._id });
  };

  // ── Code execution ────────────────────────────────────────────────────────────
  const runCode = async () => {
    const cfg = LANGS[lang];
    if (!cfg) { showToast("Language not supported", "error"); return; }

    setRunning(true);
    setShowOutput(true);
    setOutput("⏳ Running...");

    const broadcast = (finalText) => {
      socket?.emit("collab:run_output", {
        collabId,
        output: finalText,
        language: lang,
        filePath: selectedFile,
        userId: authUser?._id,
        userName: authUser?.fullName,
      });
    };

    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          language: lang,
          code: editorContent,
          filename: selectedFile || `main${cfg.ext}`,
        }),
      });

      const data = await res.json();

      if (!res.ok) { const msg = `❌ ${data.error || "Execution failed"}`; setOutput(msg); broadcast(msg); return; }

      const msg = formatExecutionResult(data);
      setOutput(msg);
      broadcast(msg);
    } catch (e) {
      setOutput(`❌ Network error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Ask AI Assistant ──────────────────────────────────────────────────────────
  const askAI = async () => {
    const question = aiQuery.trim();
    if (!question) return;
    setIsAiLoading(true);
    setAiResponse("");
    setAiQuery("");

    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/ask-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question,
          code: editorContent,
          language: lang,
          output: output 
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get AI response");
      
      setAiResponse(data.answer);
    } catch (error) {
      setAiResponse(`❌ Error: ${error.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // ── Sockets ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !authUser?._id) return;
    socket.emit("collab:join", { collabId, userId: authUser._id });

    const onEditorChg = ({ content, filePath, userId }) => {
      if (viewingFrom === userId || selectedFile === filePath) setEditorContent(content);
    };
    const onFileSelected = ({ filePath, userId }) => {
      if (viewingFrom === userId && mode === "github") selectGhFile(filePath);
    };
    const onShareReq = ({ fromUserId, toUserId }) => {
      if (String(toUserId) === String(authUser._id)) setIncomingShare(fromUserId);
    };
    const onShareAccepted = ({ viewerUserId }) => {
      if (String(viewerUserId) !== String(authUser._id)) {
        setShareActive(true);
        showToast(`${partner?.fullName || "Partner"} is viewing your editor`, "info");
      }
    };
    const onShareRejected = () => showToast("Share request declined", "info");
    const onShareRevoked = () => { setViewingFrom(null); showToast("Screen share ended", "info"); };
    const onCommitted = ({ message, userId }) => {
      if (String(userId) !== String(authUser._id)) {
        showToast(`Partner committed: "${message}"`, "success");
        loadRootFiles();
      }
    };
    const onUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["collab", collabId] });
      queryClient.invalidateQueries({ queryKey: ["authUser"] });
    };

    // When a partner runs code, show their output if you're viewing their shared editor.
    const onRunOutput = ({ output, userId, language, userName }) => {
      if (String(userId) === String(authUser?._id)) return;
      const who = userName || partner?.fullName || "Partner";
      if (viewingFrom && String(viewingFrom) === String(userId)) {
        setShowOutput(true);
        setOutput(output);
        showToast(`${who} ran ${language} — showing their output`, "info");
      } else {
        showToast(`${who} ran ${language}. Accept their share to see the output.`, "info");
      }
    };

    socket.on("collab:editor_change", onEditorChg);
    socket.on("collab:file_selected", onFileSelected);
    socket.on("collab:share_request", onShareReq);
    socket.on("collab:share_accepted", onShareAccepted);
    socket.on("collab:share_rejected", onShareRejected);
    socket.on("collab:share_revoked", onShareRevoked);
    socket.on("collab:committed", onCommitted);
    socket.on("collab:updated", onUpdated);
    socket.on("collab:run_output", onRunOutput);

    return () => {
      socket.emit("collab:leave", { collabId, userId: authUser._id });
      ["collab:editor_change","collab:file_selected","collab:share_request",
       "collab:share_accepted","collab:share_rejected","collab:share_revoked",
       "collab:committed","collab:updated","collab:run_output"].forEach(e => socket.off(e));
    };
  }, [socket, authUser?._id, collabId, viewingFrom, selectedFile, mode,
      partner?.fullName, selectGhFile, showToast, queryClient, loadRootFiles]);

  // screen share helpers
  const requestShare = () => { socket?.emit("collab:share_request", { collabId, fromUserId: authUser._id, toUserId: partner?._id }); showToast("Share request sent...", "info"); };
  const acceptShare = () => { setViewingFrom(incomingShare); setIncomingShare(null); socket?.emit("collab:share_accepted", { collabId, viewerUserId: authUser._id }); showToast("Viewing partner live", "success"); };
  const rejectShare = () => { setIncomingShare(null); socket?.emit("collab:share_rejected", { collabId, viewerUserId: authUser._id }); };
  const revokeShare = () => { setShareActive(false); socket?.emit("collab:share_revoked", { collabId }); showToast("Share ended", "info"); };

  const localTree = buildTree(localFiles);

  if (loadingCollab) return <div className="flex justify-center items-center h-screen"><span className="loading loading-spinner loading-lg" /></div>;
  if (!collab) return <div className="flex justify-center items-center h-screen"><p>Collab not found.</p></div>;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-base-100 relative">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 alert shadow-lg max-w-sm ${
          toast.type === "success" ? "alert-success" : toast.type === "error" ? "alert-error" : "alert-info"
        }`}><span>{toast.msg}</span></div>
      )}

      {/* Share request modal */}
      {incomingShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg">Editor Share Request</h3>
            <p className="text-sm opacity-70">Partner wants to share their editor with you in real time.</p>
            <div className="flex gap-3">
              <button className="btn btn-success flex-1" onClick={acceptShare}><CheckCircleIcon className="size-4 mr-1" />Accept</button>
              <button className="btn btn-error btn-outline flex-1" onClick={rejectShare}><XCircleIcon className="size-4 mr-1" />Decline</button>
            </div>
          </div>
        </div>
      )}

      {/* Create repo modal */}
      {showRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <GitBranchIcon className="size-5 text-primary" />Create Shared Repo
            </h3>
            <p className="text-sm opacity-60">
              {localFiles.length} local file{localFiles.length !== 1 ? "s" : ""} will be pushed to GitHub.
              Your partner will receive a GitHub collaborator invite automatically.
            </p>
            <div className="bg-base-200 rounded p-2 max-h-28 overflow-y-auto space-y-0.5">
              {localFiles.map(f => (
                <div key={f.path} className="text-xs opacity-60 flex items-center gap-1">
                  <FileIcon className="size-3" />{f.path}
                </div>
              ))}
            </div>
            <input
              className="input input-bordered w-full"
              placeholder="Repository name..."
              value={repoName}
              onChange={e => setRepoName(e.target.value.replace(/\s+/g, "-"))}
              onKeyDown={e => e.key === "Enter" && repoName.trim() && doCreateRepo()}
              autoFocus
            />
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={() => doCreateRepo()} disabled={creatingRepo || !repoName.trim()}>
                {creatingRepo ? <span className="loading loading-spinner loading-sm" /> : <><GitBranchIcon className="size-4 mr-1" />Create & Push</>}
              </button>
              <button className="btn btn-ghost flex-1" onClick={() => setShowRepoModal(false)}>Later</button>
            </div>
          </div>
        </div>
      )}

      {/* New file modal */}
      {showNewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2"><FilePlusIcon className="size-5" />New File</h3>
            <select className="select select-bordered w-full" value={newFileLang} onChange={e => setNewFileLang(e.target.value)}>
              {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.name} ({v.ext})</option>)}
            </select>
            <input
              className="input input-bordered w-full"
              placeholder={`e.g. solution${LANGS[newFileLang]?.ext}`}
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createFile()}
              autoFocus
            />
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={createFile} disabled={!newFileName.trim()}>Create</button>
              <button className="btn btn-ghost flex-1" onClick={() => { setShowNewFile(false); setNewFileName(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {showRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card bg-base-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2"><PencilIcon className="size-5" />Rename</h3>
            <input
              className="input input-bordered w-full"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && renameFile()}
              autoFocus
            />
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={renameFile}>Rename</button>
              <button className="btn btn-ghost flex-1" onClick={() => { setShowRename(false); setRenameTarget(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/collab")}>← Back</button>
          <div className="flex items-center gap-2">
            <div className="avatar"><div className="w-7 rounded-full"><img src={partner?.profilePic || "/avatar.png"} alt="partner" /></div></div>
            <span className="font-semibold text-sm">{partner?.fullName || "Partner"}</span>
          </div>
          {collab.githubRepoUrl && (
            <a href={collab.githubRepoUrl} target="_blank" rel="noopener noreferrer" className="badge badge-outline badge-sm gap-1 text-primary">
              <LinkIcon className="size-3" />{collab.githubRepoName}
            </a>
          )}
          <span className={`badge badge-sm ${mode === "github" ? "badge-success" : "badge-warning"}`}>
            {mode === "github" ? "📁 GitHub" : "💾 Local"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          
          {/* Docs Links */}
          <div className="hidden md:flex items-center gap-3 mr-1 pr-3 border-r border-base-300">
            {LANGS[lang]?.docs?.map((doc, idx) => (
              <a key={idx} href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline flex items-center gap-1 opacity-80 hover:opacity-100">
                <BookOpenIcon className="size-3" /> {doc.name}
              </a>
            ))}
          </div>

          {/* Language selector */}
          <select className="select select-bordered select-xs" value={lang} onChange={e => setLang(e.target.value)}>
            {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>

          {/* Ask AI Button */}
          <button className={`btn btn-sm ${showAI ? 'btn-primary' : 'btn-outline btn-primary'}`} onClick={() => setShowAI(!showAI)}>
            <SparklesIcon className="size-4 mr-1" /> AI Assist
          </button>

          {/* Run */}
          <button className="btn btn-success btn-sm" onClick={runCode} disabled={running}>
            {running ? <span className="loading loading-spinner loading-xs" /> : <><PlayIcon className="size-4 mr-1" />Run</>}
          </button>

          {/* Share */}
          {viewingFrom
            ? <button className="btn btn-warning btn-sm" onClick={() => setViewingFrom(null)}><MonitorOffIcon className="size-4 mr-1" />Stop Viewing</button>
            : shareActive
            ? <button className="btn btn-warning btn-sm" onClick={revokeShare}><MonitorOffIcon className="size-4 mr-1" />Stop Sharing</button>
            : <button className="btn btn-outline btn-sm" onClick={requestShare}><MonitorIcon className="size-4 mr-1" />Share</button>}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div className="w-60 shrink-0 bg-base-200 border-r border-base-300 flex flex-col overflow-hidden">

          {/* Panel header */}
          <div className="px-3 py-2 border-b border-base-300 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
              {mode === "github" ? "Repo Files" : "Local Files"}
            </span>
            <div className="flex gap-1">
              {mode === "local" && (
                <button className="btn btn-ghost btn-xs" onClick={() => setShowNewFile(true)} title="New file">
                  <FilePlusIcon className="size-3" />
                </button>
              )}
              {mode === "github" && (
                <button className="btn btn-ghost btn-xs" onClick={loadRootFiles} title="Refresh">
                  <RefreshCwIcon className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* File tree */}
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {mode === "local" ? (
              localTree.length === 0
                ? <div className="text-center p-4"><p className="text-xs opacity-40">No files</p><button className="btn btn-outline btn-xs mt-2" onClick={() => setShowNewFile(true)}>New File</button></div>
                : localTree.map(n => (
                    <LocalNode key={n.path} node={n}
                      onSelect={selectLocalFile} selectedPath={selectedFile}
                      onDelete={deleteFile} onRename={node => { setRenameTarget(node); setNewFileName(node.name); setShowRename(true); }} />
                  ))
            ) : (
              loadingFiles
                ? <div className="flex justify-center pt-6"><span className="loading loading-spinner loading-sm" /></div>
                : rootFiles.length === 0
                ? <div className="text-center p-3"><p className="text-xs opacity-40">No files</p><button className="btn btn-ghost btn-xs mt-2" onClick={loadRootFiles}>Refresh</button></div>
                : rootFiles.map(item => (
                    <GhNode key={item.sha} item={item} collabId={collabId}
                      onSelect={selectGhFile} selectedPath={selectedFile} />
                  ))
            )}
          </div>

          {/* Bottom actions */}
          <div className="shrink-0 border-t border-base-300">

            {/* Local mode: GitHub connect / create repo */}
            {mode === "local" && (
              <div className="p-3 space-y-2">
                {!authUser?.githubUsername ? (
                  <>
                    <p className="text-xs opacity-60 text-center">Connect GitHub to push your files</p>
                    <button className="btn btn-primary btn-sm w-full" onClick={connectGithub}>
                      <GitBranchIcon className="size-3.5 mr-1" />Connect GitHub
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs opacity-60 text-center">{localFiles.length} file{localFiles.length !== 1 ? "s" : ""} ready to push</p>
                    <button className="btn btn-primary btn-sm w-full" onClick={() => setShowRepoModal(true)}>
                      <GitBranchIcon className="size-3.5 mr-1" />Create Repo & Push
                    </button>
                  </>
                )}
              </div>
            )}

            {/* GitHub mode: waiting for partner repo */}
            {mode === "github" && !amIOwner && !collab.githubRepoName && (
              <div className="p-3 text-center">
                <span className="loading loading-dots loading-sm" />
                <p className="text-xs opacity-50 mt-1">Waiting for partner to create repo...</p>
              </div>
            )}

            {/* Commit panel */}
            {mode === "github" && selectedFile && !viewingFrom && (
              <div className="p-3 space-y-2 bg-base-300">
                <div className="flex items-center gap-1 text-xs font-semibold opacity-60 uppercase tracking-wider">
                  <GitCommitIcon className="size-3" />Commit
                </div>
                <p className="text-xs opacity-50 truncate">📄 {selectedFile}{isDirty && <span className="text-warning ml-1">● unsaved</span>}</p>
                <input
                  className="input input-bordered input-xs w-full text-xs"
                  placeholder={`Update ${selectedFile}`}
                  value={commitMsg}
                  onChange={e => setCommitMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && isDirty) doCommit(); }}
                />
                <button
                  className={`btn btn-xs w-full ${commitOk ? "btn-success" : isDirty ? "btn-primary" : "btn-disabled"}`}
                  onClick={() => doCommit()}
                  disabled={!isDirty || committing}
                >
                  {committing
                    ? <span className="loading loading-spinner loading-xs" />
                    : commitOk
                    ? <><CheckCircleIcon className="size-3 mr-1" />Committed!</>
                    : <><SaveIcon className="size-3 mr-1" />{isDirty ? "Commit & Push" : "No Changes"}</>}
                </button>
              </div>
            )}

            {authUser?.githubUsername && (
              <div className="px-3 py-1.5 text-xs opacity-40 flex items-center gap-1 truncate">
                <GitBranchIcon className="size-3 shrink-0" />@{authUser.githubUsername}
              </div>
            )}
          </div>
        </div>

        {/* Editor + Output */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Tab bar */}
          <div className="flex items-center gap-2 px-4 py-1.5 bg-base-100 border-b border-base-300 text-xs shrink-0">
            {selectedFile
              ? <><FileIcon className="size-3 opacity-60" /><span className="opacity-70">{selectedFile}</span>{isDirty && <span className="text-warning ml-1">●</span>}</>
              : <span className="opacity-40">Select or create a file</span>}
            <div className="ml-auto flex items-center gap-2">
              {viewingFrom && <span className="badge badge-warning badge-sm">👁 Viewing Live</span>}
              {shareActive && <span className="badge badge-info badge-sm">📡 Sharing</span>}
              {showOutput && (
                <button className="btn btn-ghost btn-xs" onClick={() => setShowOutput(false)}>Hide Output ✕</button>
              )}
            </div>
          </div>

          {/* Monaco editor */}
          <div className={showOutput ? "h-[55%]" : "flex-1"}>
            <Editor
              height="100%"
              language={lang}
              value={editorContent}
              onChange={onEditorChange}
              onMount={ed => (editorRef.current = ed)}
              theme="vs-dark"
              options={{
                fontSize: 14, minimap: { enabled: false }, wordWrap: "on",
                tabSize: 2, scrollBeyondLastLine: false, readOnly: !!viewingFrom,
                cursorBlinking: "smooth",
              }}
            />
          </div>

          {/* Output panel */}
          {showOutput && (
            <div className="flex-1 bg-[#1e1e1e] border-t border-base-300 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-1.5 bg-[#2d2d2d] shrink-0">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Output</span>
                {running && <span className="loading loading-spinner loading-xs text-green-400" />}
              </div>
              <pre className="flex-1 overflow-auto p-4 text-sm text-green-400 font-mono whitespace-pre-wrap">
                {output || "Run your code to see output here"}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* AI Floating Panel */}
      {showAI && (
        <div className="absolute bottom-6 right-6 w-[26rem] h-[28rem] max-h-[85vh] bg-base-100 shadow-2xl rounded-xl border border-base-300 flex flex-col overflow-hidden z-50">
          <div className="bg-primary text-primary-content px-4 py-3 flex justify-between items-center shrink-0">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <SparklesIcon className="size-4" /> Code Assistant
            </h3>
            <button onClick={() => { setShowAI(false); setAiResponse(""); }} title="Hide assistant" className="opacity-70 hover:opacity-100 hover:scale-110 transition-transform">✕</button>
          </div>
          
          <div className="p-4 flex-1 min-h-0 overflow-y-auto text-sm bg-base-100 flex flex-col">
            {aiResponse ? (
              <div className="bg-base-200 p-3 rounded-lg prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-xs font-sans bg-transparent p-0 m-0 text-base-content">{aiResponse}</pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center opacity-60 text-center space-y-2">
                <SparklesIcon className="size-8" />
                <p className="text-xs">
                  Ask me to explain this code, find bugs, or suggest improvements! I have context of your current file.
                </p>
              </div>
            )}
            {isAiLoading && <div className="text-center pt-4 mt-auto"><span className="loading loading-dots loading-md text-primary" /></div>}
          </div>

          <div className="p-3 bg-base-200 border-t border-base-300 shrink-0">
            <div className="flex gap-2">
              <input 
                type="text" 
                className="input input-bordered input-sm flex-1" 
                placeholder="Why is my code failing?" 
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askAI()}
              />
              <button className="btn btn-primary btn-sm" onClick={askAI} disabled={isAiLoading || !aiQuery.trim()}>
                Ask
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── VIDEO CONFERENCE OVERLAY (non-intrusive; fixed-position) ─── */}
      <MeetingFeature
        roomId={collabId}
        authUser={authUser}
        socket={socket}
        roomHostId={collab?.requester?._id || collab?.requester}
      />

    </div>
  );
};

export default CollabPage;