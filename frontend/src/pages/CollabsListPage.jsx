import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CodeIcon, CheckCircleIcon, XCircleIcon, BellIcon } from "lucide-react";
import { getMyCollabs, acceptCollabRequest, rejectCollabRequest } from "../lib/collab.api";
import useAuthUser from "../hooks/useAuthUser.js";
import useSocket from "../hooks/useSocket.js";

const CollabsListPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { authUser } = useAuthUser();
  const { socket } = useSocket();

  // Toast for real-time notifications
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const { data: collabs = [], isLoading } = useQuery({
    queryKey: ["myCollabs"],
    queryFn: getMyCollabs,
  });

  const { mutate: accept, isPending: accepting } = useMutation({
    mutationFn: acceptCollabRequest,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
      // Navigate straight into the collab editor
      navigate(`/collab/${data._id}`);
    },
  });

  const { mutate: reject, isPending: rejecting } = useMutation({
    mutationFn: rejectCollabRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
    },
  });

  // ── Real-time socket: listen for new incoming collab requests ────────────────
  useEffect(() => {
    if (!socket) return;

    const handleNewRequest = ({ requester }) => {
      // Refresh the list so the new request appears immediately
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
      showToast(
        `${requester?.fullName || "Someone"} sent you a collab request!`,
        "info"
      );
    };

    const handleRequestAccepted = () => {
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
      showToast("Your collab request was accepted!", "success");
    };

    const handleRequestRejected = () => {
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
      showToast("Your collab request was declined.", "error");
    };

    socket.on("collab:new_request", handleNewRequest);
    socket.on("collab:request_accepted", handleRequestAccepted);
    socket.on("collab:request_rejected", handleRequestRejected);

    return () => {
      socket.off("collab:new_request", handleNewRequest);
      socket.off("collab:request_accepted", handleRequestAccepted);
      socket.off("collab:request_rejected", handleRequestRejected);
    };
  }, [socket, queryClient]);

  // Split collabs into categories
  const incomingRequests = collabs.filter(
    (c) =>
      c.status === "pending" &&
      String(c.requester) !== String(authUser?._id)
  );

  const outgoingRequests = collabs.filter(
    (c) =>
      c.status === "pending" &&
      String(c.requester) === String(authUser?._id)
  );

  const activeCollabs = collabs.filter((c) => c.status === "active");

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-10">

      {/* Toast notification */}
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
          <BellIcon className="size-4 shrink-0" />
          <span>{toast.msg}</span>
        </div>
      )}

      <h1 className="text-3xl font-bold flex items-center gap-3">
        <CodeIcon className="size-8" />
        My Collabs
      </h1>

      {/* ── Incoming Requests ── */}
      {incomingRequests.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            Incoming Collab Requests
            <span className="badge badge-warning">{incomingRequests.length}</span>
          </h2>
          <div className="space-y-3">
            {incomingRequests.map((collab) => {
              const requester = collab.participants.find(
                (p) => String(p._id) === String(collab.requester)
              );
              return (
                <div
                  key={collab._id}
                  className="card bg-base-200 p-4 flex flex-row items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="avatar">
                      <div className="w-10 rounded-full">
                        <img
                          src={requester?.profilePic || "/avatar.png"}
                          alt={requester?.fullName}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold">{requester?.fullName}</p>
                      <p className="text-xs opacity-60">
                        Wants to start a collab session with you
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => accept(collab._id)}
                      disabled={accepting}
                    >
                      <CheckCircleIcon className="size-4" />
                      Accept
                    </button>
                    <button
                      className="btn btn-error btn-outline btn-sm"
                      onClick={() => reject(collab._id)}
                      disabled={rejecting}
                    >
                      <XCircleIcon className="size-4" />
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Outgoing Requests ── */}
      {outgoingRequests.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Sent Requests</h2>
          <div className="space-y-3">
            {outgoingRequests.map((collab) => {
              const other = collab.participants.find(
                (p) => String(p._id) !== String(authUser?._id)
              );
              return (
                <div
                  key={collab._id}
                  className="card bg-base-200 p-4 flex flex-row items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="avatar">
                      <div className="w-10 rounded-full">
                        <img
                          src={other?.profilePic || "/avatar.png"}
                          alt={other?.fullName}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold">{other?.fullName}</p>
                      <p className="text-xs opacity-60">Waiting for them to accept...</p>
                    </div>
                  </div>
                  <span className="badge badge-warning">Pending</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Active Collabs ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          Active Collabs
          <span className="badge badge-primary">{activeCollabs.length}</span>
        </h2>

        {activeCollabs.length === 0 ? (
          <div className="card bg-base-200 p-6 text-center opacity-60">
            <p>No active collabs yet. Send a collab request to a friend from the Home page!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeCollabs.map((collab) => {
              const other = collab.participants.find(
                (p) => String(p._id) !== String(authUser?._id)
              );
              return (
                <div
                  key={collab._id}
                  className="card bg-base-200 hover:shadow-lg transition-all cursor-pointer"
                  onClick={() => navigate(`/collab/${collab._id}`)}
                >
                  <div className="card-body p-4">
                    <div className="flex items-center gap-3">
                      <div className="avatar">
                        <div className="w-12 rounded-full">
                          <img
                            src={other?.profilePic || "/avatar.png"}
                            alt={other?.fullName}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold">{other?.fullName}</p>
                        {collab.githubRepoName ? (
                          <a
                            href={collab.githubRepoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {collab.githubRepoName}
                          </a>
                        ) : (
                          <p className="text-xs opacity-50">No repo linked yet</p>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm mt-3 w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/collab/${collab._id}`);
                      }}
                    >
                      <CodeIcon className="size-4 mr-1" />
                      Open Collab Editor
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default CollabsListPage;