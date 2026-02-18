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

export function registerCollabSocketHandlers(io, socket) {
  const userId = socket.handshake.query.userId;

  // Register this socket as online
  if (userId) {
    onlineUsers.set(userId, socket.id);
  }

  socket.on("disconnect", () => {
    if (userId) onlineUsers.delete(userId);
  });

  // ── Join a collab room ──────────────────────────────────────────────────────
  socket.on("collab:join", ({ collabId, userId }) => {
    socket.join(`collab:${collabId}`);
    socket.to(`collab:${collabId}`).emit("collab:user_joined", { userId });
  });

  socket.on("collab:leave", ({ collabId, userId }) => {
    socket.leave(`collab:${collabId}`);
    socket.to(`collab:${collabId}`).emit("collab:user_left", { userId });
  });

  // ── Real-time editor sync ───────────────────────────────────────────────────
  socket.on("collab:editor_change", ({ collabId, content, filePath, userId }) => {
    socket.to(`collab:${collabId}`).emit("collab:editor_change", {
      content,
      filePath,
      userId,
    });
  });

  socket.on("collab:cursor", ({ collabId, position, userId }) => {
    socket.to(`collab:${collabId}`).emit("collab:cursor", { position, userId });
  });

  // ── Screen / Editor Share ───────────────────────────────────────────────────
  socket.on("collab:share_request", ({ collabId, fromUserId, toUserId }) => {
    io.to(`collab:${collabId}`).emit("collab:share_request", {
      fromUserId,
      toUserId,
    });
  });

  socket.on("collab:share_accepted", ({ collabId, viewerUserId }) => {
    io.to(`collab:${collabId}`).emit("collab:share_accepted", { viewerUserId });
  });

  socket.on("collab:share_rejected", ({ collabId, viewerUserId }) => {
    io.to(`collab:${collabId}`).emit("collab:share_rejected", { viewerUserId });
  });

  socket.on("collab:share_revoked", ({ collabId }) => {
    io.to(`collab:${collabId}`).emit("collab:share_revoked");
  });

  // ── File selection sync ─────────────────────────────────────────────────────
  socket.on("collab:file_selected", ({ collabId, filePath, userId }) => {
    socket.to(`collab:${collabId}`).emit("collab:file_selected", { filePath, userId });
  });

  // ── Commit notification ─────────────────────────────────────────────────────
  socket.on("collab:committed", ({ collabId, filePath, message, userId }) => {
    socket.to(`collab:${collabId}`).emit("collab:committed", { filePath, message, userId });
  });
}