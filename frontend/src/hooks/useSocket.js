import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import useAuthUser from "./useAuthUser";
import { BACKEND_ORIGIN } from "../lib/axios";

const SOCKET_URL = BACKEND_ORIGIN;

const useSocket = () => {
  const { authUser } = useAuthUser();
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Only connect if user is logged in
    if (!authUser?._id) return;

    // If already connected, don't create a new connection
    if (socketRef.current?.connected) return;

    socketRef.current = io(SOCKET_URL, {
      withCredentials: true,
      query: { userId: authUser._id }, // sends userId to backend on connect
    });

    socketRef.current.on("connect", () => {
      setIsConnected(true);
      console.log("Socket connected:", socketRef.current.id);
    });

    socketRef.current.on("disconnect", () => {
      setIsConnected(false);
      console.log("Socket disconnected");
    });

    // Cleanup on logout / unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
    };
  }, [authUser?._id]);

  return {
    socket: socketRef.current,
    isConnected,
  };
};

export default useSocket;
