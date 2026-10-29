import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { signup } from "../lib/api";

const useSignup = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutate, isPending, error } = useMutation({
    mutationFn: signup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["authUser"] });

      const authUser = queryClient.getQueryData(["authUser"])?.user;
      if (authUser) {
        toast.success("Account created successfully!");
        navigate("/onboarding", { replace: true });
      } else {
        toast.success("Account created. Please sign in to continue.");
        navigate("/login", { replace: true });
      }
    },
  });

  return { error, isPending, signupMutation: mutate };
};

export default useSignup;