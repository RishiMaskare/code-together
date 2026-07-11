import React from "react";
import useAuthUser from "../hooks/useAuthUser";
import { useLocation, Link } from "react-router";
import { BellIcon, HandshakeIcon, HomeIcon, UserIcon, CodeIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getMyCollabs } from "../lib/collab.api";

const Sidebar = () => {
  const { authUser } = useAuthUser();
  const location = useLocation();
  const currentPath = location.pathname;

  const { data: collabs = [] } = useQuery({
    queryKey: ["myCollabs"],
    queryFn: getMyCollabs,
    refetchInterval: 30000,
  });

  const pendingCount = collabs.filter(
    (c) => c.status === "pending" && String(c.requester) !== String(authUser?._id)
  ).length;

  const activeCount = collabs.filter((c) => c.status === "active").length;

  return (
    <aside className="w-64 bg-base-200 border-r border-base-300 hidden lg:flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-base-300">
        <Link to="/home" className="flex items-center gap-2.5">
          <HandshakeIcon className="size-9 text-primary" />
          <span className="text-2xl font-bold font-mono bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary tracking-wider">
            CodeTogether
          </span>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <Link
          to="/home"
          className={`btn btn-ghost justify-start w-full gap-3 px-3 normal-case ${
            currentPath === "/" ? "btn-active" : ""
          }`}
        >
          <HomeIcon className="size-5 text-base-content opacity-70" />
          <span>Home</span>
        </Link>

        <Link
          to="/friends"
          className={`btn btn-ghost justify-start w-full gap-3 px-3 normal-case ${
            currentPath === "/friends" ? "btn-active" : ""
          }`}
        >
          <UserIcon className="size-5 text-base-content opacity-70" />
          <span>Friends</span>
        </Link>

        <Link
          to="/notifications"
          className={`btn btn-ghost justify-start w-full gap-3 px-3 normal-case ${
            currentPath === "/notifications" ? "btn-active" : ""
          }`}
        >
          <BellIcon className="size-5 text-base-content opacity-70" />
          <span>Notifications</span>
        </Link>

        <Link
          to="/collab"
          className={`btn btn-ghost justify-start w-full gap-3 px-3 normal-case ${
            currentPath === "/collab" ? "btn-active" : ""
          }`}
        >
          <div className="relative">
            <CodeIcon className="size-5 text-base-content opacity-70" />
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-error text-white text-[10px] rounded-full size-4 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </div>
          <span>Collabs</span>
          {activeCount > 0 && (
            <span className="ml-auto badge badge-primary badge-sm">
              {activeCount}
            </span>
          )}
        </Link>
      </nav>

      {/* USER PROFILE SECTION */}
      <div className="p-4 border-t border-base-300 mt-auto">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img src={authUser?.profilePic} alt="User Avatar" />
            </div>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">{authUser?.fullName}</p>
            <p className="text-xs text-success flex items-center gap-1">
              <span className="size-2 rounded-full bg-success inline-block" />
              Online
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;