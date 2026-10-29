import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { logout } from "../lib/api";

const privateQueryKeys = new Set([
  "friends",
  "recommendedUsers",
  "outgoingFriendReqs",
  "friendRequests",
  "streamToken",
  "myCollabs",
  "collab",
]);

const useLogout = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutate, isPending, error } = useMutation({
    mutationFn: logout,

    onSuccess: async () => {
      const privateQueries = {
        predicate: (query) => privateQueryKeys.has(query.queryKey[0]),
      };

      await queryClient.cancelQueries(privateQueries);
      queryClient.setQueryData(["authUser"], null);
      queryClient.removeQueries(privateQueries);
      navigate("/login", { replace: true });
    },

    onError: (error) => {
      toast.error(
        error?.response?.data?.message || "Logout failed. Please try again."
      );
    },
  });

  return {
    error,
    isPending,
    logoutMutation: mutate,
  };
};

export default useLogout;
