import React, { useState } from "react";
import useAuthUser from "../hooks/useAuthUser";
import { useLocation, Link, useNavigate } from "react-router-dom"; 
import { useQuery } from "@tanstack/react-query"; 
import { BellIcon, HandshakeIcon, LogOutIcon, PresentationIcon, KeyIcon, UsersIcon, UserPlusIcon } from "lucide-react";
import ThemeSelector from "./ThemeSelector.jsx";
import useLogout from "../hooks/useLogout.js";
import { getUserFriends } from "../lib/api"; 
import toast from "react-hot-toast"; // NEW: For success messages

const Navbar = () => {
  const { authUser } = useAuthUser();
  const location = useLocation();
  const navigate = useNavigate();
  const isChatPage = location.pathname?.startsWith("/chat");

  const { logoutMutation } = useLogout();

  // Classroom Modal State
  const [showClassModal, setShowClassModal] = useState(false);
  const [classMode, setClassMode] = useState("join"); 
  const [joinCode, setJoinCode] = useState("");
  const [hostCode, setHostCode] = useState("");

  // Team Collab Modal State
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [teamName, setTeamName] = useState("");
  const [isSendingTeam, setIsSendingTeam] = useState(false);

  // Fetch friends from the database
  const { data: friends = [], isLoading: isLoadingFriends } = useQuery({
    queryKey: ["friends"],
    queryFn: getUserFriends,
    enabled: showTeamModal, 
  });

  const handleHostClick = () => {
    setClassMode("host");
    setHostCode(Math.random().toString(36).substring(2, 8).toUpperCase());
  };

  const enterClassroom = (role) => {
    const code = role === "host" ? hostCode : joinCode.trim().toUpperCase();
    if (!code) return;
    setShowClassModal(false);
    navigate(`/classroom/${code}`, { state: { role } });
  };

  const toggleFriendSelection = (friendId) => {
    setSelectedFriends(prev => 
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    );
  };

  // SEND DB REQUEST FOR TEAM COLLAB
  const startTeamCollab = async () => {
    if (selectedFriends.length === 0) return;
    setIsSendingTeam(true);

    try {
      const backendUrl = import.meta.env.MODE === "development" ? "http://localhost:5001" : "";
      const res = await fetch(`${backendUrl}/api/collab/team-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          friendIds: selectedFriends, 
          teamName: teamName || "New Team Project" 
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Team invites sent successfully!");
        setShowTeamModal(false);
        setSelectedFriends([]);
        setTeamName("");
        // Optionally redirect them directly to the waiting room:
        navigate(`/team-collab/${data._id}`);
      } else {
        toast.error(data.message || "Failed to create team.");
      }
    } catch (error) {
      toast.error("Network error while creating team.");
    } finally {
      setIsSendingTeam(false);
    }
  };

  return (
    <>
      <nav className="bg-base-200 border-b border-base-300 sticky top-0 z-30 h-16 flex items-center">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between w-full">
            
            <div className="flex-1">
              {isChatPage && (
                <div className="pl-5">
                  <Link to="/home" className="flex items-center gap-2.5">
                    <HandshakeIcon className="size-9 text-primary" />
                    <span className="text-3xl font-bold font-mono bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary tracking-wider">
                      CodeTogether
                    </span>
                  </Link>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              
              <button 
                className="btn btn-outline btn-secondary btn-sm flex items-center gap-2 hidden sm:flex"
                onClick={() => { setShowTeamModal(true); setSelectedFriends([]); }}
              >
                <UsersIcon className="size-4" /> Team
              </button>

              <button 
                className="btn btn-outline btn-primary btn-sm flex items-center gap-2 hidden sm:flex"
                onClick={() => { setShowClassModal(true); setClassMode("join"); }}
              >
                <PresentationIcon className="size-4" /> Classroom
              </button>

              <div className="flex sm:hidden gap-1">
                <button className="btn btn-ghost btn-circle" onClick={() => { setShowTeamModal(true); setSelectedFriends([]); }}>
                  <UsersIcon className="w-5 h-5 text-secondary" />
                </button>
                <button className="btn btn-ghost btn-circle" onClick={() => { setShowClassModal(true); setClassMode("join"); }}>
                  <PresentationIcon className="w-5 h-5 text-primary" />
                </button>
              </div>

              <Link to={"/notifications"}>
                <button className="btn btn-ghost btn-circle">
                  <BellIcon className="w-6 h-6 text-base-content opacity-70" />
                </button>
              </Link>

              <ThemeSelector />
              
              <div className="avatar">
                <Link to="/onboarding">
                  <div className="w-9 rounded-full">
                    <img src={authUser?.profilePic || "/avatar.png"} alt="User Avatar" />
                  </div>
                </Link>
              </div>

              <button className="btn btn-ghost btn-circle" onClick={logoutMutation}>
                <LogOutIcon className="w-6 h-6 text-base-content opacity-70" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Classroom Modal */}
      {showClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card bg-base-100 p-6 shadow-2xl max-w-sm w-full border border-base-300">
            <h3 className="font-bold text-xl mb-4 flex items-center gap-2">
              <PresentationIcon className="size-6 text-primary" /> Code Classroom
            </h3>
            
            <div className="tabs tabs-boxed mb-4 justify-center">
              <button className={`tab ${classMode === 'join' ? 'tab-active' : ''}`} onClick={() => setClassMode("join")}>Join Class</button>
              <button className={`tab ${classMode === 'host' ? 'tab-active' : ''}`} onClick={handleHostClick}>Host Class</button>
            </div>

            {classMode === "join" && (
              <div className="space-y-4">
                <p className="text-sm opacity-70">Enter the 6-character code provided by your host.</p>
                <div className="relative">
                  <KeyIcon className="absolute left-3 top-3 size-4 opacity-50" />
                  <input type="text" className="input input-bordered w-full pl-10 uppercase font-mono tracking-widest" placeholder="e.g. A1B2C3" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={6} autoFocus />
                </div>
                <button className="btn btn-primary w-full" disabled={joinCode.length < 3} onClick={() => enterClassroom("student")}><UsersIcon className="size-4 mr-1" /> Join Class</button>
              </div>
            )}

            {classMode === "host" && (
              <div className="space-y-4 text-center">
                <p className="text-sm opacity-70">Share this code with your participants to let them join.</p>
                <div className="bg-base-200 p-4 rounded-lg border border-base-300">
                  <span className="text-3xl font-mono font-bold tracking-[0.2em] text-primary">{hostCode}</span>
                </div>
                <button className="btn btn-primary w-full" onClick={() => enterClassroom("host")}><PresentationIcon className="size-4 mr-1" /> Start Hosting</button>
              </div>
            )}

            <button className="btn btn-ghost w-full mt-2" onClick={() => setShowClassModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Team Collab Modal (UPDATED) */}
      {showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card bg-base-100 p-6 shadow-2xl max-w-sm w-full border border-base-300">
            <h3 className="font-bold text-xl mb-2 flex items-center gap-2">
              <UsersIcon className="size-6 text-secondary" /> Create Team
            </h3>
            
            <input 
              type="text" 
              placeholder="Team Project Name (Optional)" 
              className="input input-bordered input-sm w-full mb-4 mt-2"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
            />

            <p className="text-sm opacity-70 mb-2 font-semibold">Select Friends to Invite:</p>
            <div className="max-h-48 overflow-y-auto space-y-2 mb-4 bg-base-200 p-2 rounded-lg border border-base-300">
              {isLoadingFriends ? (
                <div className="flex justify-center py-4"><span className="loading loading-spinner loading-md text-secondary"></span></div>
              ) : friends && friends.length > 0 ? (
                friends.map((friend) => (
                  <label key={friend._id} className="flex items-center gap-3 p-2 hover:bg-base-300 rounded cursor-pointer transition-colors">
                    <input type="checkbox" className="checkbox checkbox-sm checkbox-secondary" checked={selectedFriends.includes(friend._id)} onChange={() => toggleFriendSelection(friend._id)} />
                    <div className="avatar"><div className="w-8 rounded-full"><img src={friend.profilePic || "/avatar.png"} alt={friend.fullName || "Friend"} /></div></div>
                    <span className="text-sm font-medium">{friend.fullName || friend.username}</span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-center opacity-50 py-4">No friends available to invite.</p>
              )}
            </div>

            <button className="btn btn-secondary w-full" onClick={startTeamCollab} disabled={selectedFriends.length === 0 || isSendingTeam}>
              {isSendingTeam ? <span className="loading loading-spinner loading-sm" /> : <><UserPlusIcon className="size-4 mr-1" /> Send Invites ({selectedFriends.length})</>}
            </button>
            <button className="btn btn-ghost w-full mt-2" onClick={() => setShowTeamModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;