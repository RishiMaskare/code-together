import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAuthUser, login } from "../lib/api";

const useLogin = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutate, isPending, error } = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["authUser"] });

      try {
        const authData = await getAuthUser();
        queryClient.setQueryData(["authUser"], authData);

        if (!authData?.user) {
          toast.error(
            "Login succeeded, but the session was not established. Check your browser's cross-site cookie settings and try again."
          );
          return;
        }

        navigate(authData.user.isOnboarded ? "/home" : "/onboarding", {
          replace: true,
        });
      } catch {
        queryClient.setQueryData(["authUser"], null);
        toast.error("Unable to verify your login session. Please try again.");
      }
    },
  });

  return { error, isPending, loginMutation: mutate };
};

export default useLogin;
