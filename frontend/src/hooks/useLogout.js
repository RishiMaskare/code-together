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
      const sessionQueries = {
        predicate: (query) =>
          query.queryKey[0] === "authUser" ||
          privateQueryKeys.has(query.queryKey[0]),
      };

      await queryClient.cancelQueries(sessionQueries);
      queryClient.removeQueries({
        predicate: (query) => privateQueryKeys.has(query.queryKey[0]),
      });
      queryClient.setQueryData(["authUser"], null);
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
