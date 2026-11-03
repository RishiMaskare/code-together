import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import useAuthUser from "./useAuthUser";
import { axiosInstance, BACKEND_ORIGIN } from "../lib/axios";

const SOCKET_URL = BACKEND_ORIGIN;

const useSocket = () => {
  const { authUser } = useAuthUser();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    if (!authUser?._id) {
      setSocket(null);
      setIsConnected(false);
      setConnectionError(null);
      return;
    }

    let disposed = false;
    const activeSocket = io(SOCKET_URL, {
      withCredentials: true,
      auth: (callback) => {
        axiosInstance
          .get("/auth/socket-token")
          .then(({ data }) => {
            if (!disposed) callback({ token: data.token });
          })
          .catch((error) => {
            if (disposed) return;
            setConnectionError(
              error?.response?.data?.message || error.message || "Could not authenticate the socket."
            );
            callback({ token: null });
          });
      },
    });
    setSocket(activeSocket);

    activeSocket.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
      console.log("Socket connected:", activeSocket.id);
    });

    activeSocket.on("disconnect", () => {
      setIsConnected(false);
      console.log("Socket disconnected");
    });

    activeSocket.on("connect_error", (error) => {
      setIsConnected(false);
      setConnectionError(error.message);
      console.error("Socket connection failed:", error);
    });

    return () => {
      disposed = true;
      activeSocket.disconnect();
      setSocket((current) => current === activeSocket ? null : current);
      setIsConnected(false);
    };
  }, [authUser?._id]);

  return {
    socket,
    isConnected,
    connectionError,
  };
};

export default useSocket;
