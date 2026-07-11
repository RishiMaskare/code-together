import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { 
  UsersIcon, PresentationIcon, LockIcon, UnlockIcon, 
  MonitorIcon, LogOutIcon, SparklesIcon, PlayIcon,
  FolderOpenIcon, UploadIcon, DownloadIcon, FileTextIcon, XIcon
} from "lucide-react";
import useAuthUser from "../hooks/useAuthUser.js";
import useSocket from "../hooks/useSocket.js";

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
  
  const [isCodingAllowed, setIsCodingAllowed] = useState(false);
  const [isAiAllowed, setIsAiAllowed] = useState(false);
  const [lang, setLang] = useState("javascript"); 
  
  const [students, setStudents] = useState([]); 
  const [studentCodes, setStudentCodes] = useState({}); 
  const [viewingId, setViewingId] = useState("host"); 
  
  const [hostCode, setHostCode] = useState("// Waiting for host to start typing...");
  const [myStudentCode, setMyStudentCode] = useState("");

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

  // Reference to latest state
  const stateRef = useRef({ hostCode, isCodingAllowed, resources });
  useEffect(() => {
    stateRef.current = { hostCode, isCodingAllowed, resources };
  }, [hostCode, isCodingAllowed, resources]);

  // ─── SOCKET LOGIC ──────────────────────────────────────────────────────
  
  useEffect(() => {
    if (!socket || !authUser) return;

    socket.emit("class:join", { roomId, user: authUser, role });

    const onStudentJoined = ({ user, socketId }) => {
      if (!isHost) return;
      setStudents(prev => prev.find(p => p._id === user._id) ? prev : [...prev, user]);
      socket.emit("class:sync_to_student", { 
        socketId, 
        content: stateRef.current.hostCode, 
        isCodingAllowed: stateRef.current.isCodingAllowed,
        isAiAllowed,
        resources: stateRef.current.resources // Sync resources to late joiners!
      });
    };

    const onStudentLeft = ({ userId }) => {
      if (!isHost) return;
      setStudents(prev => prev.filter(p => p._id !== userId));
      setViewingId(prev => prev === userId ? "host" : prev); 
    };

    const onStudentCodeChange = ({ userId, content }) => {
      if (isHost) setStudentCodes(prev => ({ ...prev, [userId]: content }));
    };

    const onInitialSync = ({ content, isCodingAllowed: allowed, isAiAllowed: aiAllowed, resources: syncedResources }) => {
      if (isHost) return;
      setHostCode(content);
      setIsCodingAllowed(allowed);
      setIsAiAllowed(aiAllowed);
      if (syncedResources) setResources(syncedResources);
      if (!allowed) setMyStudentCode(content); 
    };

    const onHostCodeChange = ({ content }) => {
      if (isHost) return;
      setHostCode(content);
      if (!stateRef.current.isCodingAllowed) setMyStudentCode(content);
    };

    const onCodingAllowed = ({ allowed }) => {
      if (isHost) return;
      setIsCodingAllowed(allowed);
      if (allowed) setMyStudentCode(stateRef.current.hostCode);
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
    socket.on("class:student_code_change", onStudentCodeChange);
    socket.on("class:initial_sync", onInitialSync);
    socket.on("class:host_code_change", onHostCodeChange);
    socket.on("class:coding_allowed", onCodingAllowed);
    socket.on("class:ai_allowed", onAiAllowed);
    socket.on("class:receive_resource", onReceiveResource);

    return () => {
      socket.off("class:student_joined", onStudentJoined);
      socket.off("class:student_left", onStudentLeft);
      socket.off("class:student_code_change", onStudentCodeChange);
      socket.off("class:initial_sync", onInitialSync);
      socket.off("class:host_code_change", onHostCodeChange);
      socket.off("class:coding_allowed", onCodingAllowed);
      socket.off("class:ai_allowed", onAiAllowed);
      socket.off("class:receive_resource", onReceiveResource);
    };
  }, [socket, authUser, roomId, role, isHost, isAiAllowed]); 

  // ─── ACTIONS ───────────────────────────────────────────────────────────

  const toggleCodingAllowance = () => {
    if (!isHost) return;
    const newState = !isCodingAllowed;
    setIsCodingAllowed(newState);
    socket.emit("class:set_coding_allowed", { roomId, allowed: newState });
  };

  const toggleAiAllowance = () => {
    if (!isHost) return;
    const newState = !isAiAllowed;
    setIsAiAllowed(newState);
    if (!newState) setShowAI(false);
    socket.emit("class:set_ai_allowed", { roomId, allowed: newState });
  };

  let currentDisplayCode = "";
  let isReadOnly = true;

  if (isHost) {
    if (viewingId === "host") {
      currentDisplayCode = hostCode;
      isReadOnly = false;
    } else {
      currentDisplayCode = studentCodes[viewingId] || "// Student hasn't typed anything yet...";
      isReadOnly = true; 
    }
  } else {
    currentDisplayCode = isCodingAllowed ? myStudentCode : hostCode;
    isReadOnly = !isCodingAllowed; 
  }

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly: isReadOnly });
    }
  }, [isReadOnly]);

  const handleEditorChange = (value) => {
    const val = value || "";
    if (isHost && viewingId === "host") {
      setHostCode(val);
      socket.emit("class:host_code_change", { roomId, content: val });
    } else if (!isHost && isCodingAllowed) {
      setMyStudentCode(val);
      socket.emit("class:student_code_change", { roomId, userId: authUser._id, content: val });
    }
  };

  const runCode = async () => { /* ... Keep exact same Judge0 code here ... */
    setIsRunning(true);
    setShowOutput(true);
    setOutput("⏳ Running...");
    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ language: lang, code: currentDisplayCode }),
      });
      const data = await res.json();
      if (!res.ok) { setOutput(`❌ ${data.error || "Execution failed"}`); return; }
      if (data.compile_stderr) { setOutput(`⚠️ Compile Error:\n${data.compile_stderr}`); return; }
      if (data.compile_code !== undefined && data.compile_code !== 0 && data.compile_stderr) { setOutput(`⚠️ Compile Error:\n${data.compile_stderr}`); return; }
      if (data.error) { setOutput(`❌ Error:\n${data.error}`); return; }
      const stdout = data.stdout || "";
      const stderr = data.stderr || "";
      if (stdout && stderr) setOutput(`${stdout}\n\n⚠️ stderr:\n${stderr}`);
      else if (stdout) setOutput(stdout);
      else if (stderr) setOutput(`❌ Runtime Error:\n${stderr}`);
      else if (data.exit_code !== undefined && data.exit_code !== 0) setOutput(`⚠️ Program exited with code ${data.exit_code}`);
      else setOutput("✅ Finished with no output.");
    } catch (e) {
      setOutput(`❌ Network error: ${e.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const askAI = async () => { /* ... Keep exact same AI code here ... */
    if (!aiQuery.trim()) return;
    setIsAiLoading(true); setAiResponse("");
    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/ask-ai`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ question: aiQuery, code: currentDisplayCode, language: lang, output: output }),
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

          {!isHost && (
            <div className={`badge ${isCodingAllowed ? 'badge-success' : 'badge-warning'} gap-1`}>
              {isCodingAllowed ? <UnlockIcon className="size-3" /> : <LockIcon className="size-3" />}
              {isCodingAllowed ? "Coding Allowed" : "Read Only"}
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

          {/* HOST ONLY CONTROLS */}
          {isHost && (
            <>
              <button 
                className={`btn btn-sm ${isAiAllowed ? 'btn-error' : 'btn-info'}`}
                onClick={toggleAiAllowance}
                title="Toggle AI for Students"
              >
                {isAiAllowed ? "Revoke AI" : "Allow AI"}
              </button>

              <div className="flex items-center gap-2 border-l border-r border-base-300 px-3 mx-1">
                <MonitorIcon className="size-5 opacity-60 hidden md:block" />
                <select 
                  className="select select-bordered select-sm w-28 sm:w-36"
                  value={viewingId}
                  onChange={(e) => setViewingId(e.target.value)}
                >
                  <option value="host">My Screen</option>
                  <optgroup label={`Students (${students.length})`}>
                    {students.map(s => (
                      <option key={s._id} value={s._id}>{s.fullName || s.username}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <button 
                className={`btn btn-sm ${isCodingAllowed ? 'btn-error' : 'btn-success'}`}
                onClick={toggleCodingAllowance}
              >
                {isCodingAllowed ? (
                  <><LockIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">Revoke Coding</span></>
                ) : (
                  <><UnlockIcon className="size-4 sm:mr-1" /> <span className="hidden sm:inline">Allow Coding</span></>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── MAIN EDITOR & OUTPUT AREA ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {isHost && viewingId !== "host" && (
          <div className="absolute top-4 right-8 z-10 pointer-events-none">
            <div className="alert alert-info shadow-lg py-2">
              <UsersIcon className="size-5" />
              <span>Viewing student in read-only mode.</span>
            </div>
          </div>
        )}

        <div className={showOutput ? "h-[60%] relative" : "flex-1 relative"}>
          <Editor
            height="100%"
            language={lang}
            value={currentDisplayCode}
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
        <div className="absolute bottom-6 right-6 w-80 sm:w-[26rem] bg-base-100 shadow-2xl rounded-xl border border-base-300 flex flex-col overflow-hidden z-50">
          <div className="bg-primary text-primary-content px-4 py-3 flex justify-between items-center">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <SparklesIcon className="size-4" /> Code Assistant
            </h3>
            <button onClick={() => setShowAI(false)} className="opacity-70 hover:opacity-100 transition-transform"><XIcon className="size-4" /></button>
          </div>
          
          <div className="p-4 flex-1 h-80 overflow-y-auto text-sm bg-base-100 flex flex-col">
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

          <div className="p-3 bg-base-200 border-t border-base-300">
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