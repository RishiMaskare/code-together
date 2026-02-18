// import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CodeIcon, CheckCircleIcon, ClockIcon } from "lucide-react";
import { sendCollabRequest, getMyCollabs } from "../lib/collab.api";
import { useNavigate } from "react-router";

/**
 * CollabButton
 * Props:
 *   friendId - the friend's _id
 *
 * Place this component in your FriendCard, below the Message button.
 * Example:
 *   <CollabButton friendId={friend._id} />
 */
const CollabButton = ({ friendId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: collabs = [] } = useQuery({
    queryKey: ["myCollabs"],
    queryFn: getMyCollabs,
  });

  const existingCollab = collabs.find(
    (c) =>
      c.participants.some((p) => (p._id || p) === friendId) &&
      c.status !== "closed"
  );

  const { mutate: requestCollab, isPending } = useMutation({
    mutationFn: () => sendCollabRequest(friendId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myCollabs"] });
    },
  });

  if (existingCollab?.status === "active") {
    return (
      <button
        className="btn btn-success btn-sm w-full mt-1"
        onClick={() => navigate(`/collab/${existingCollab._id}`)}
      >
        <CodeIcon className="size-4 mr-1" />
        Open Collab
      </button>
    );
  }

  if (existingCollab?.status === "pending") {
    return (
      <button className="btn btn-disabled btn-sm w-full mt-1" disabled>
        <ClockIcon className="size-4 mr-1" />
        Collab Pending
      </button>
    );
  }

  return (
    <button
      className="btn btn-outline btn-sm w-full mt-1"
      onClick={() => requestCollab()}
      disabled={isPending}
    >
      <CodeIcon className="size-4 mr-1" />
      {isPending ? "Sending..." : "Start Collab"}
    </button>
  );
};

export default CollabButton;
