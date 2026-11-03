import Collab from "../models/Collab.js";

/**
 * collab.socket.js
 *
 * Attach to your existing io.on("connection") block in server.js:
 *   registerCollabSocketHandlers(io, socket, onlineUsers);
 *
 * onlineUsers is a Map<userId, socketId> — add this to your server.js too.
 */

// Track online users: Map<userId, socketId>
export const onlineUsers = new Map();
const pendingShareRequests = new Map();
const latestCollabState = new Map();

export function registerCollabSocketHandlers(
  io,
  socket,
  { canJoinCollab = defaultCanJoinCollab } = {}
) {
  const userId = socket.handshake.query.userId;

  // Register this socket as online
  if (userId) {
    onlineUsers.set(userId, socket.id);
  }

  socket.on("disconnect", () => {
    if (userId) onlineUsers.delete(userId);
  });

  // ── Join a collab room ──────────────────────────────────────────────────────
  socket.on("collab:join", async ({ collabId } = {}) => {
    const authenticatedUserId = socket.authUser?._id;
    if (!collabId || !authenticatedUserId) {
      socket.emit("collab:join_denied", {
        collabId,
        message: "Sign in before joining a collaboration.",
      });
      return;
    }

    let allowed;
    try {
      allowed = await canJoinCollab(collabId, authenticatedUserId);
    } catch (error) {
      console.error("[collab:join] Failed to verify collaboration access:", error);
      socket.emit("collab:join_denied", {
        collabId,
        message: "Unable to verify collaboration access. Please try again.",
      });
      return;
    }

    if (!allowed) {
      socket.emit("collab:join_denied", {
        collabId,
        message: "This collaboration starts after the request is accepted.",
      });
      return;
    }

    const room = `collab:${collabId}`;
    await socket.join(room);
    socket.emit("collab:joined", { collabId });
    const currentState = latestCollabState.get(room);
    if (currentState) socket.emit("collab:sync_state", currentState);
    socket.to(room).emit("collab:user_joined", {
      userId: authenticatedUserId,
    });
  });

  socket.on("collab:leave", ({ collabId } = {}) => {
    if (!collabId) return;
    const room = `collab:${collabId}`;
    const request = pendingShareRequests.get(room);
    if (
      request &&
      [request.fromUserId, request.toUserId].includes(socket.authUser?._id)
    ) {
      pendingShareRequests.delete(room);
    }
    socket.leave(room);
    socket.to(room).emit("collab:user_left", {
      userId: socket.authUser?._id,
    });
    clearRoomStateIfEmpty(io, room, socket.id);
  });

  socket.on("disconnecting", () => {
    for (const room of socket.rooms || []) {
      if (room.startsWith("collab:")) {
        clearRoomStateIfEmpty(io, room, socket.id);
      }
    }
  });

  // ── Real-time editor sync ───────────────────────────────────────────────────
  socket.on("collab:editor_change", ({ collabId, content, filePath, language } = {}) => {
    if (!isJoinedToCollab(socket, collabId) || typeof content !== "string") return;
    const state = {
      content,
      filePath,
      language,
      userId: socket.authUser._id,
    };
    latestCollabState.set(`collab:${collabId}`, state);
    socket.to(`collab:${collabId}`).emit("collab:editor_change", {
      ...state,
    });
  });

  socket.on("collab:cursor", ({ collabId, position } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    socket.to(`collab:${collabId}`).emit("collab:cursor", {
      position,
      userId: socket.authUser._id,
    });
  });

  // ── Run output (so partners viewing your editor also see your run results) ──
  socket.on("collab:run_output", ({ collabId, output, language, filePath, userName } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    socket.to(`collab:${collabId}`).emit("collab:run_output", {
      output,
      language,
      filePath,
      userId: socket.authUser._id,
      userName: socket.authUser.fullName || userName,
    });
  });

  // ── Screen / Editor Share ───────────────────────────────────────────────────
  socket.on("collab:share_request", ({ collabId, toUserId } = {}) => {
    if (!isJoinedToCollab(socket, collabId) || !toUserId) return;
    const fromUserId = socket.authUser._id;
    if (String(fromUserId) === String(toUserId)) return;
    const recipientUserId = String(toUserId);
    pendingShareRequests.set(`collab:${collabId}`, {
      fromUserId,
      toUserId: recipientUserId,
    });
    io.to(`collab:${collabId}`).emit("collab:share_request", {
      fromUserId,
      toUserId: recipientUserId,
    });
  });

  socket.on(
    "collab:share_accepted",
    ({ collabId, viewerUserId, ownerUserId } = {}) => {
      if (!isJoinedToCollab(socket, collabId)) return;
      const request = pendingShareRequests.get(`collab:${collabId}`);
      if (
        !request ||
        request.toUserId !== socket.authUser._id ||
        request.fromUserId !== ownerUserId
      ) {
        return;
      }
      pendingShareRequests.delete(`collab:${collabId}`);
      io.to(`collab:${collabId}`).emit("collab:share_accepted", {
        viewerUserId: socket.authUser._id,
        ownerUserId,
      });
    }
  );

  socket.on("collab:share_state", ({ collabId, content, filePath, language } = {}) => {
    if (!isJoinedToCollab(socket, collabId) || typeof content !== "string") return;
    socket.to(`collab:${collabId}`).emit("collab:share_state", {
      userId: socket.authUser._id,
      content,
      filePath,
      language,
    });
  });

  socket.on("collab:share_rejected", ({ collabId } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    const request = pendingShareRequests.get(`collab:${collabId}`);
    if (!request || request.toUserId !== socket.authUser._id) return;
    pendingShareRequests.delete(`collab:${collabId}`);
    io.to(`collab:${collabId}`).emit("collab:share_rejected", {
      viewerUserId: socket.authUser._id,
    });
  });

  socket.on("collab:share_revoked", ({ collabId } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    pendingShareRequests.delete(`collab:${collabId}`);
    io.to(`collab:${collabId}`).emit("collab:share_revoked");
  });

  // ── File selection sync ─────────────────────────────────────────────────────
  socket.on("collab:file_selected", (payload = {}) => {
    const { collabId, filePath, content, language } = payload;
    if (!isJoinedToCollab(socket, collabId)) return;
    const state = {
      filePath,
      content,
      language,
      userId: socket.authUser._id,
    };
    if (typeof content === "string") {
      latestCollabState.set(`collab:${collabId}`, state);
    }
    socket.to(`collab:${collabId}`).emit("collab:file_selected", state);
  });

  // ── Commit notification ─────────────────────────────────────────────────────
  socket.on("collab:committed", ({ collabId, filePath, message } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    socket.to(`collab:${collabId}`).emit("collab:committed", {
      filePath,
      message,
      userId: socket.authUser._id,
    });
  });
}

async function defaultCanJoinCollab(collabId, userId) {
  const collab = await Collab.findById(collabId).select("participants status");
  return (
    collab?.status === "active" &&
    collab.participants.some((participant) => String(participant) === userId)
  );
}

function isJoinedToCollab(socket, collabId) {
  return Boolean(
    collabId &&
      socket.authUser?._id &&
      socket.rooms?.has(`collab:${collabId}`)
  );
}

function clearRoomStateIfEmpty(io, room, departingSocketId) {
  const roomMembers = io.sockets?.adapter?.rooms?.get(room);
  if (
    !roomMembers ||
    roomMembers.size === 0 ||
    (roomMembers.size === 1 && roomMembers.has(departingSocketId))
  ) {
    latestCollabState.delete(room);
    pendingShareRequests.delete(room);
  }
}

export function registerTeamCollabSocketHandlers(socket) {
  socket.on("team:take_control", (payload = {}) => {
    if (!isJoinedToCollab(socket, payload.collabId)) return;
    socket.to(`collab:${payload.collabId}`).emit("team:take_control", {
      collabId: payload.collabId,
      userId: socket.authUser._id,
      content: payload.content,
      filePath: payload.filePath,
    });
  });

  socket.on("team:release_control", ({ collabId } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    socket.to(`collab:${collabId}`).emit("team:release_control");
  });

  socket.on("team:request_state", ({ collabId } = {}) => {
    if (!isJoinedToCollab(socket, collabId)) return;
    socket.to(`collab:${collabId}`).emit("team:request_state");
  });
}