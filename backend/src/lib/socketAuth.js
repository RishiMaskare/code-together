import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Minimal cookie parser for the Socket.IO handshake.
 * The browser sends the same httpOnly `jwt` cookie used by the REST API.
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
 * Verifies the `jwt` cookie on the handshake and attaches a lightweight,
 * TRUSTED identity to the socket. Meeting handlers must use `socket.authUser`
 * and NEVER trust an id/role sent inside an event payload.
 *
 * Existing (legacy) handlers keep working because they read their own
 * `socket.user`/`query.userId`; we do not overwrite those here.
 */
export async function authenticateSocket(socket, next) {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie || "");
    const token = cookies.jwt;

    if (!token) {
      // Allow the connection but leave socket.authUser null.
      // Protected meeting handlers will reject unauthenticated actions.
      socket.authUser = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("fullName email profilePic");

    if (!user) {
      socket.authUser = null;
      return next();
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
    socket.authUser = null;
    return next();
  }
}
