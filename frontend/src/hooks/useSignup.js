import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAuthUser, signup } from "../lib/api";

const useSignup = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutate, isPending, error } = useMutation({
    mutationFn: signup,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["authUser"] });

      try {
        const authData = await getAuthUser();
        queryClient.setQueryData(["authUser"], authData);

        if (authData?.user) {
          toast.success("Account created successfully!");
          navigate(authData.user.isOnboarded ? "/home" : "/onboarding", {
            replace: true,
          });
        } else {
          toast.success("Account created. Please sign in to continue.");
          navigate("/login", { replace: true });
        }
      } catch {
        queryClient.setQueryData(["authUser"], null);
        toast.success("Account created. Please sign in to continue.");
        navigate("/login", { replace: true });
      }
    },
  });

  return { error, isPending, signupMutation: mutate };
};

export default useSignup;