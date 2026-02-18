import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { CodeIcon } from "lucide-react";
import { getMyCollabs } from "../lib/collab.api";

const CollabNavItem = () => {
  const { pathname } = useLocation();
  const { data: collabs = [] } = useQuery({
    queryKey: ["myCollabs"],
    queryFn: getMyCollabs,
    refetchInterval: 30000,
  });

  const activeCollabs = collabs.filter((c) => c.status === "active");
  const pendingCollabs = collabs.filter((c) => c.status === "pending");
  const isActive = pathname.startsWith("/collab");

  return (
    <Link
      to="/collab"
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        isActive ? "bg-primary text-primary-content" : "hover:bg-base-300"
      }`}
    >
      <div className="relative">
        <CodeIcon className="size-5" />
        {pendingCollabs.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 badge badge-warning badge-xs">
            {pendingCollabs.length}
          </span>
        )}
      </div>
      <span className="font-medium">Collabs</span>
      {activeCollabs.length > 0 && (
        <span className="ml-auto badge badge-primary badge-sm">
          {activeCollabs.length}
        </span>
      )}
    </Link>
  );
};

export default CollabNavItem;
