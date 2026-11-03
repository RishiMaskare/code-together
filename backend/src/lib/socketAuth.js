import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Minimal cookie parser for Socket.IO clients that can send the httpOnly JWT.
 */
function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

/**
 * Socket.IO authentication middleware.
 *
 * Verifies a short-lived socket token or same-origin JWT cookie and attaches a
 * trusted identity. Event payloads must never supply the authenticated user ID.
 */
export async function authenticateSocket(socket, next) {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie || "");
    const handshakeToken = socket.handshake.auth?.token;
    const token = handshakeToken || cookies.jwt;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (handshakeToken && decoded.purpose !== "socket") {
      return next(new Error("Invalid socket token"));
    }
    const user = await User.findById(decoded.userId).select("fullName email profilePic");

    if (!user) {
      return next(new Error("Authenticated user not found"));
    }

    socket.authUser = {
      _id: user._id.toString(),
      id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      profilePic: user.profilePic || "",
    };

    return next();
  } catch (err) {
    console.warn("[socketAuth] verification failed:", err.message);
    return next(new Error("Socket authentication failed"));
  }
}
