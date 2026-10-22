import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { 
  UsersIcon, PresentationIcon, LockIcon, UnlockIcon, 
  LogOutIcon, SparklesIcon, PlayIcon,
  FolderOpenIcon, UploadIcon, DownloadIcon, FileTextIcon, XIcon
} from "lucide-react";
import useAuthUser from "../hooks/useAuthUser.js";
import useSocket from "../hooks/useSocket.js";
import { formatExecutionResult } from "../lib/utils.js";
import toast from "react-hot-toast";

const LANGS = {
  javascript: { name: "JavaScript" },
  typescript: { name: "TypeScript" },
  python:     { name: "Python" },
  java:       { name: "Java" },
  cpp:        { name: "C++" },
  c:          { name: "C" },
  go:         { name: "Go" },
  rust:       { name: "Rust" },
};

const ClassroomPage = () => {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { authUser } = useAuthUser();
  const { socket } = useSocket();
  const editorRef = useRef(null);

  const role = location.state?.role || "student"; 
  const isHost = role === "host";

  // ─── STATE ─────────────────────────────────────────────────────────────
  
  const [isAiAllowed, setIsAiAllowed] = useState(false);
  const [lang, setLang] = useState("javascript"); 

  // Shared editor + turn-based control
  const [code, setCode] = useState("// Waiting for someone to start typing...");
  const [controllerId, setControllerId] = useState(null);   // userId currently allowed to type
  const [controllerName, setControllerName] = useState(""); // display name of the controller

  const [students, setStudents] = useState([]); // joined students (host shows the count)

  const [showAI, setShowAI] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  // RESOURCE SHARING STATE
  const [showResources, setShowResources] = useState(false);
  const [resources, setResources] = useState([]); // { id, type: 'text'|'file', name, data, timestamp }
  const [resourceText, setResourceText] = useState("");

  // Reference to latest state (used inside socket callbacks to avoid stale closures)
  const stateRef = useRef({ code, controllerId, controllerName, isAiAllowed, resources });
  useEffect(() => {
    stateRef.current = { code, controllerId, controllerName, isAiAllowed, resources };
  }, [code, controllerId, controllerName, isAiAllowed, resources]);

  // ─── SOCKET LOGIC ──────────────────────────────────────────────────────
  
  useEffect(() => {
    if (!socket || !authUser) return;

    socket.emit("class:join", { roomId, user: authUser, role });

    const onStudentJoined = ({ user, socketId }) => {
      if (!isHost) return;
      setStudents(prev => prev.find(p => p._id === user._id) ? prev : [...prev, user]);
      // Send the new student the current shared document + who (if anyone) is editing
      socket.emit("class:sync_to_student", {
        socketId,
        content: stateRef.current.code,
        controllerId: stateRef.current.controllerId,
        controllerName: stateRef.current.controllerName,
        isAiAllowed: stateRef.current.isAiAllowed,
        resources: stateRef.current.resources,
      });
    };

    const onStudentLeft = ({ userId }) => {
      setStudents(prev => prev.filter(p => p._id !== userId));
      // If the person who left was editing, unlock the editor for everyone
      if (stateRef.current.controllerId === userId) {
        setControllerId(null);
        setControllerName("");
        toast("The editor is now open — anyone can type.");
      }
    };

    // A keystroke from the active controller -> update the shared document live
    const onCodeChange = ({ content }) => {
      setCode(content);
    };

    // Someone grabbed control: lock everyone else and alert them
    const onTakeControl = ({ userId, userName, content }) => {
      setControllerId(userId);
      setControllerName(userName || "");
      if (typeof content === "string") setCode(content);
      if (userId !== authUser._id) {
        toast.error(`${userName || "Someone"} started editing — you are now in read-only mode.`, { id: "class-control" });
      } else {
        toast.success("You are now editing. Others are locked.", { id: "class-control" });
      }
    };

    const onReleaseControl = ({ userId }) => {
      setControllerId(null);
      setControllerName("");
      if (userId !== authUser._id) {
        toast("The editor is now open — anyone can type.", { id: "class-control" });
      }
    };

    const onInitialSync = ({ content, controllerId: cid, controllerName: cname, isAiAllowed: aiAllowed, resources: syncedResources }) => {
      if (isHost) return;
      if (typeof content === "string") setCode(content);
      setControllerId(cid ?? null);
      setControllerName(cname ?? "");
      setIsAiAllowed(!!aiAllowed);
      if (syncedResources) setResources(syncedResources);
    };

    const onAiAllowed = ({ allowed }) => {
      if (isHost) return;
      setIsAiAllowed(allowed);
      if (!allowed) setShowAI(false);
    };

    const onReceiveResource = ({ resource }) => {
      if (isHost) return; // Host already has it in local state
      setResources(prev => [...prev, resource]);
    };

    socket.on("class:student_joined", onStudentJoined);
    socket.on("class:student_left", onStudentLeft);
    socket.on("class:code_change", onCodeChange);
    socket.on("class:take_control", onTakeControl);
    socket.on("class:release_control", onReleaseControl);
    socket.on("class:initial_sync", onInitialSync);
    socket.on("class:ai_allowed", onAiAllowed);
    socket.on("class:receive_resource", onReceiveResource);

    return () => {
      socket.off("class:student_joined", onStudentJoined);
      socket.off("class:student_left", onStudentLeft);
      socket.off("class:code_change", onCodeChange);
      socket.off("class:take_control", onTakeControl);
      socket.off("class:release_control", onReleaseControl);
      socket.off("class:initial_sync", onInitialSync);
      socket.off("class:ai_allowed", onAiAllowed);
      socket.off("class:receive_resource", onReceiveResource);
    };
  }, [socket, authUser, roomId, role, isHost]); 

  // ─── ACTIONS ───────────────────────────────────────────────────────────

  const toggleAiAllowance = () => {
    if (!isHost) return;
    const newState = !isAiAllowed;
    setIsAiAllowed(newState);
    if (!newState) setShowAI(false);
    socket.emit("class:set_ai_allowed", { roomId, allowed: newState });
  };

  // Who (if anyone) currently holds the pen for the shared editor
  const isController = !!controllerId && controllerId === authUser?._id;
  const someoneElseEditing = !!controllerId && !isController;
  const isReadOnly = someoneElseEditing;

  // Grab the pen: broadcast to everyone that we are now editing + hand over the current doc
  const grabControl = (contentSnapshot) => {
    if (!authUser?._id) return;
    setControllerId(authUser._id);
    setControllerName(authUser.fullName || authUser.username);
    socket.emit("class:take_control", {
      roomId,
      userId: authUser._id,
      userName: authUser.fullName || authUser.username,
      content: contentSnapshot ?? code,
    });
  };

  const releaseControl = () => {
    if (!isController) return;
    setControllerId(null);
    setControllerName("");
    socket.emit("class:release_control", { roomId, userId: authUser._id });
    toast("You released control — anyone can type now.", { id: "class-control" });
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly: isReadOnly });
    }
  }, [isReadOnly]);

  const handleEditorChange = (value) => {
    const val = value || "";
    // Already holding the pen -> just broadcast each keystroke
    if (isController) {
      setCode(val);
      socket.emit("class:code_change", { roomId, content: val });
      return;
    }
    // Nobody holds the pen -> claim it on the first keystroke
    if (!controllerId) {
      setCode(val);
      grabControl(val);
    }
    // Otherwise the editor is read-only and this won't fire
  };

  const runCode = async () => { /* ... Keep exact same Judge0 code here ... */
    setIsRunning(true);
    setShowOutput(true);
    setOutput("⏳ Running...");
    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ language: lang, code: code }),
      });
      const data = await res.json();
      if (!res.ok) { setOutput(`❌ ${data.error || "Execution failed"}`); return; }
      setOutput(formatExecutionResult(data));
    } catch (e) {
      setOutput(`❌ Network error: ${e.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const askAI = async () => { /* ... Keep exact same AI code here ... */
    const question = aiQuery.trim();
    if (!question) return;
    setIsAiLoading(true); setAiResponse(""); setAiQuery("");
    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/ask-ai`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ question, code: code, language: lang, output: output }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get AI response");
      setAiResponse(data.answer);
    } catch (error) { setAiResponse(`❌ Error: ${error.message}`); } finally { setIsAiLoading(false); }
  };

  // ─── RESOURCE SHARING FUNCTIONS ─────────────────────────────────────────

  const handleSendTextResource = () => {
    if (!resourceText.trim()) return;
    const newRes = {
      id: Date.now().toString(), type: 'text', data: resourceText, timestamp: Date.now()
    };
    setResources(prev => [...prev, newRes]);
    socket.emit("class:send_resource", { roomId, resource: newRes });
    setResourceText("");
  };

  const handleSendFileResource = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      alert("Please keep files under 5MB to ensure fast sharing.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const newRes = {
        id: Date.now().toString(), type: 'file', name: file.name, data: ev.target.result, timestamp: Date.now()
      };
      setResources(prev => [...prev, newRes]);
      socket.emit("class:send_resource", { roomId, resource: newRes });
    };
    reader.readAsDataURL(file); // Convert to base64 for socket transmission
    e.target.value = null; // reset input
  };

  const downloadFile = (name, base64Data) => {
    const a = document.createElement("a");
    a.href = base64Data;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-screen bg-base-100 relative">
      
      {/* ─── TOP BAR ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 bg-base-200 border-b border-base-300">
        <div className="flex items-center gap-4">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/home")}>
            <LogOutIcon className="size-4" /> Leave
          </button>
          
          <div className="badge badge-primary badge-lg gap-2 font-mono tracking-widest hidden sm:inline-flex">
            <PresentationIcon className="size-4" /> {roomId}
          </div>

          {/* Shared editing status (visible to everyone) */}
          <div className={`badge gap-1 ${isController ? "badge-success" : controllerId ? "badge-warning" : "badge-info"}`}>
            {isController ? <UnlockIcon className="size-3" /> : <LockIcon className="size-3" />}
            {isController
              ? "You are editing"
              : controllerId
                ? `${controllerName || "Someone"} is editing`
                : isHost && students.length === 0
                  ? "Waiting for a student…"
                  : "Editor open — start typing"}
          </div>
          {isHost && (
            <div className="badge badge-outline gap-1">
              <UsersIcon className="size-3" /> {students.length}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          
          {/* Language Selector */}
          <select className="select select-bordered select-sm w-28 sm:w-auto" value={lang} onChange={e => setLang(e.target.value)}>
            {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>

          {/* Shared Resources Button (NEW) */}
          <div className="indicator">
            {resources.length > 0 && <span className="indicator-item badge badge-primary badge-xs">{resources.length}</span>}
            <button 
              className={`btn btn-sm ${showResources ? 'btn-secondary' : 'btn-outline btn-secondary'}`} 
              onClick={() => setShowResources(!showResources)}
            >
              <FolderOpenIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">Resources</span>
            </button>
          </div>

          {/* Run Code Button */}
          <button className="btn btn-success btn-sm" onClick={runCode} disabled={isRunning}>
            {isRunning ? <span className="loading loading-spinner loading-xs" /> : <><PlayIcon className="size-4 sm:mr-1" /><span className="hidden sm:inline">Run</span></>}
          </button>

          <div className="divider divider-horizontal mx-0"></div>

          {/* Ask AI Button */}
          {(isHost || isAiAllowed) && (
            <button 
              className={`btn btn-sm ${showAI ? 'btn-info' : 'btn-outline btn-info'}`} 
              onClick={() => setShowAI(!showAI)}
            >
              <SparklesIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">AI Assist</span>
            </button>
          )}

          {/* HOST ONLY: AI permission for students */}
          {isHost && (
            <button
              className={`btn btn-sm ${isAiAllowed ? 'btn-error' : 'btn-info'}`}
              onClick={toggleAiAllowance}
              title="Toggle AI for Students"
            >
              {isAiAllowed ? "Revoke AI" : "Allow AI"}
            </button>
          )}

          {/* Turn-based control: whoever holds the pen can hand it back */}
          {isController ? (
            <button
              className="btn btn-sm btn-warning"
              onClick={releaseControl}
              title="Let someone else edit"
            >
              <LockIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">Done</span>
            </button>
          ) : someoneElseEditing ? (
            <button
              className="btn btn-sm btn-outline"
              disabled
              title={`${controllerName || "Someone"} is editing`}
            >
              <LockIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">Locked</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* ─── MAIN EDITOR & OUTPUT AREA ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {someoneElseEditing && (
          <div className="absolute top-4 right-8 z-10 pointer-events-none">
            <div className="alert alert-warning shadow-lg py-2">
              <LockIcon className="size-5" />
              <span>{controllerName || "Someone"} is editing — view only until they finish.</span>
            </div>
          </div>
        )}

        <div className={showOutput ? "h-[60%] relative" : "flex-1 relative"}>
          <Editor
            height="100%"
            language={lang}
            value={code}
            onChange={handleEditorChange}
            onMount={(ed) => {
              editorRef.current = ed;
              ed.updateOptions({ readOnly: isReadOnly }); 
            }}
            theme="vs-dark"
            options={{
              fontSize: 16, minimap: { enabled: false }, cursorBlinking: "smooth", padding: { top: 20 }
            }}
          />
        </div>

        {/* OUTPUT TERMINAL */}
        {showOutput && (
          <div className="flex-1 bg-[#1e1e1e] border-t border-base-300 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-1.5 bg-[#2d2d2d] shrink-0">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Output</span>
              <div className="flex items-center gap-3">
                {isRunning && <span className="loading loading-spinner loading-xs text-green-400" />}
                <button className="btn btn-ghost btn-xs text-gray-400 hover:text-white" onClick={() => setShowOutput(false)}>✕</button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-sm text-green-400 font-mono whitespace-pre-wrap">
              {output || "Run your code to see output here"}
            </pre>
          </div>
        )}

      </div>

      {/* ─── SHARED RESOURCES PANEL (NEW) ────────────────────────────────── */}
      {showResources && (
        <div className="absolute top-16 right-6 w-80 sm:w-96 bg-base-100 shadow-2xl rounded-xl border border-base-300 flex flex-col max-h-[70vh] z-40">
          <div className="bg-secondary text-secondary-content px-4 py-3 flex justify-between items-center rounded-t-xl">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <FolderOpenIcon className="size-4" /> Class Resources
            </h3>
            <button onClick={() => setShowResources(false)} className="opacity-70 hover:opacity-100 transition-transform"><XIcon className="size-4" /></button>
          </div>
          
          <div className="p-4 flex-1 overflow-y-auto space-y-3 bg-base-100">
            {resources.length === 0 ? (
              <p className="text-center text-xs opacity-50 py-10">No resources shared yet.</p>
            ) : (
              resources.map((res) => (
                <div key={res.id} className="bg-base-200 p-3 rounded-lg border border-base-300">
                  {res.type === 'text' ? (
                    <div>
                      <div className="flex items-center gap-2 mb-1 text-xs font-bold opacity-70">
                        <FileTextIcon className="size-3" /> Note
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{res.data}</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FolderOpenIcon className="size-4 text-info shrink-0" />
                        <span className="text-sm truncate font-medium">{res.name}</span>
                      </div>
                      <button 
                        className="btn btn-xs btn-primary btn-outline shrink-0 ml-2"
                        onClick={() => downloadFile(res.name, res.data)}
                      >
                        <DownloadIcon className="size-3 mr-1" /> Save
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Host Upload Controls */}
          {isHost && (
            <div className="p-3 bg-base-200 border-t border-base-300 space-y-2 rounded-b-xl">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  className="input input-bordered input-sm flex-1" 
                  placeholder="Type a note to share..." 
                  value={resourceText}
                  onChange={e => setResourceText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendTextResource()}
                />
                <button className="btn btn-secondary btn-sm" onClick={handleSendTextResource}>Send</button>
              </div>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-10 border-2 border-base-300 border-dashed rounded-lg cursor-pointer hover:bg-base-300 transition-colors">
                  <div className="flex items-center justify-center gap-2">
                    <UploadIcon className="size-4 opacity-70" />
                    <p className="text-xs opacity-70 font-semibold">Click to share a file</p>
                  </div>
                  <input type="file" className="hidden" onChange={handleSendFileResource} />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── AI FLOATING PANEL ───────────────────────────────────────────── */}
      {showAI && (
        <div className="absolute bottom-6 right-6 w-80 sm:w-[26rem] h-[28rem] max-h-[85vh] bg-base-100 shadow-2xl rounded-xl border border-base-300 flex flex-col overflow-hidden z-50">
          <div className="bg-primary text-primary-content px-4 py-3 flex justify-between items-center shrink-0">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <SparklesIcon className="size-4" /> Code Assistant
            </h3>
            <button onClick={() => { setShowAI(false); setAiResponse(""); }} title="Hide assistant" className="opacity-70 hover:opacity-100 transition-transform"><XIcon className="size-4" /></button>
          </div>
          
          <div className="p-4 flex-1 min-h-0 overflow-y-auto text-sm bg-base-100 flex flex-col">
            {aiResponse ? (
              <div className="bg-base-200 p-3 rounded-lg prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-xs font-sans bg-transparent p-0 m-0 text-base-content">{aiResponse}</pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center opacity-60 text-center space-y-2">
                <SparklesIcon className="size-8" />
                <p className="text-xs">Ask me to explain this code, find bugs, or suggest improvements!</p>
              </div>
            )}
            {isAiLoading && <div className="text-center pt-4 mt-auto"><span className="loading loading-dots loading-md text-primary" /></div>}
          </div>

          <div className="p-3 bg-base-200 border-t border-base-300 shrink-0">
            <div className="flex gap-2">
              <input 
                type="text" 
                className="input input-bordered input-sm flex-1" 
                placeholder="Ask something..." 
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askAI()}
              />
              <button className="btn btn-primary btn-sm" onClick={askAI} disabled={isAiLoading || !aiQuery.trim()}>Ask</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ClassroomPage;