import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import useAuthUser from "../hooks/useAuthUser";
import { useQuery } from "@tanstack/react-query";
import { getDirectVideoCallToken } from "../lib/api";

import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  CallControls,
  SpeakerLayout,
  StreamTheme,
  CallingState,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import toast from "react-hot-toast";
import PageLoader from "../components/PageLoader";

const CallPage = () => {
  const { id: callId } = useParams();
  const [client, setClient] = useState(null);
  const [call, setCall] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState("");

  const { authUser, isLoading } = useAuthUser();

  const {
    data: tokenData,
    isLoading: isTokenLoading,
    isError: tokenError,
  } = useQuery({
    queryKey: ["videoCallToken", authUser?._id, callId],
    queryFn: () => getDirectVideoCallToken(callId),
    enabled: !!authUser && !!callId,
  });

  useEffect(() => {
    if (isLoading || isTokenLoading) return undefined;

    if (!authUser || !callId || !tokenData?.token || !tokenData?.apiKey) {
      const message = tokenError || !tokenData?.token
        ? "Could not load your video-call credentials. Please refresh and try again."
        : "Video calling is not configured for this application.";
      setConnectionError(message);
      setIsConnecting(false);
      return undefined;
    }

    let disposed = false;
    let videoClient;
    let callInstance;
    let joinPromise;
    setIsConnecting(true);
    setConnectionError("");

    const initCall = async () => {
      try {
        const user = {
          id: String(authUser._id),
          name: authUser.fullName,
          image: authUser.profilePic,
        };

        videoClient = new StreamVideoClient({
          apiKey: tokenData.apiKey,
          user,
          token: tokenData.token,
        });

        callInstance = videoClient.call("default", callId);
        joinPromise = callInstance.join({
          create: true,
          data: { settings_override: { screensharing: { enabled: true } } },
        });
        await joinPromise;

        if (disposed) return;
        setClient(videoClient);
        setCall(callInstance);
      } catch (error) {
        if (disposed) return;
        console.error("Error joining call:", error);
        setConnectionError("Could not join the call. Check your connection and try again.");
        toast.error("Could not join the call. Please try again.");
      } finally {
        if (!disposed) setIsConnecting(false);
      }
    };

    initCall();

    return () => {
      disposed = true;
      void (async () => {
        if (joinPromise) {
          try {
            await joinPromise;
          } catch (cleanupError) {
            console.warn("Video call join did not finish before cleanup:", cleanupError);
          }
        }
        try {
          await callInstance?.leave();
        } catch (cleanupError) {
          console.warn("Could not leave video call cleanly:", cleanupError);
        }
        try {
          await videoClient?.disconnectUser();
        } catch (cleanupError) {
          console.warn("Could not disconnect video client cleanly:", cleanupError);
        }
      })();
    };
  }, [authUser, callId, isLoading, isTokenLoading, tokenData, tokenError]);

  if (isLoading || isTokenLoading || isConnecting) return <PageLoader />;

  return (
    <div className="h-screen flex flex-col items-center justify-center">
      <div className="relative">
        {client && call ? (
          <StreamVideo client={client}>
            <StreamCall call={call}>
              <CallContent />
            </StreamCall>
          </StreamVideo>
        ) : (
          <div className="flex items-center justify-center h-full p-6 text-center">
            <p>{connectionError || "Could not initialize call. Please refresh or try again later."}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const CallContent = () => {
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();

  const navigate = useNavigate();

  useEffect(() => {
    if (callingState === CallingState.LEFT) navigate("/home");
  }, [callingState, navigate]);

  return (
    <StreamTheme>
      <SpeakerLayout />
        <CallControls />
    </StreamTheme>
  );
};

export default CallPage;
