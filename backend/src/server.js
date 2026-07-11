import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/user.route.js";
import chatRoutes from "./routes/chat.route.js";
import collabRoutes from "./routes/collab.route.js"; 

import { connectDB } from "./lib/db.js";
import { registerCollabSocketHandlers } from "./lib/collab.socket.js"; 

const app = express();
const PORT = process.env.PORT;

const __dirname = path.resolve();

// Wrap express app in an HTTP server so Socket.io can attach to it
const httpServer = createServer(app);

// Create Socket.io server
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
});

// Attach io to app so controllers can access it via req.app.get("io")
app.set("io", io);

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/collab", collabRoutes);

// Socket.io connection handler
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  
  // Existing 1-on-1 collab handlers
  registerCollabSocketHandlers(io, socket);

  // ─── CLASSROOM SOCKET EVENTS ─────────────────────────────────────────────
  
  // 1. Join a classroom
  socket.on("class:join", ({ roomId, user, role }) => {
    socket.join(`class:${roomId}`);
    socket.user = user;
    socket.role = role;
    socket.roomId = roomId;

    if (role === "student") {
      socket.to(`class:${roomId}`).emit("class:student_joined", { user, socketId: socket.id });
    } else {
      socket.to(`class:${roomId}`).emit("class:host_joined", { user });
    }
  });

  // 2. Host syncs initial state to a newly joined student (UPDATED with AI & Resources)
  socket.on("class:sync_to_student", ({ socketId, content, isCodingAllowed, isAiAllowed, resources }) => {
    io.to(socketId).emit("class:initial_sync", { content, isCodingAllowed, isAiAllowed, resources });
  });

  // 3. Host is typing
  socket.on("class:host_code_change", ({ roomId, content }) => {
    socket.to(`class:${roomId}`).emit("class:host_code_change", { content });
  });

  // 4. Host toggles coding permission
  socket.on("class:set_coding_allowed", ({ roomId, allowed }) => {
    socket.to(`class:${roomId}`).emit("class:coding_allowed", { allowed });
  });

  // 4.5 Host toggles AI permission
  socket.on("class:set_ai_allowed", ({ roomId, allowed }) => {
    socket.to(`class:${roomId}`).emit("class:ai_allowed", { allowed });
  });

  // 4.6 Host shares a resource (NEW!)
  socket.on("class:send_resource", ({ roomId, resource }) => {
    socket.to(`class:${roomId}`).emit("class:receive_resource", { resource });
  });

  // 5. Student is typing
  socket.on("class:student_code_change", ({ roomId, userId, content }) => {
    socket.to(`class:${roomId}`).emit("class:student_code_change", { userId, content });
  });
// ─── TEAM COLLAB SOCKET EVENTS ─────────────────────────────────────────────
  socket.on("team:take_control", (payload) => {
    // payload contains { collabId, userId, content, filePath }
    socket.to(payload.collabId).emit("team:take_control", payload);
  });

  socket.on("team:release_control", ({ collabId }) => {
    socket.to(collabId).emit("team:release_control");
  });
  // ─────────────────────────────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    
    // Classroom disconnect logic - remove student from host's dropdown
    if (socket.roomId && socket.role === "student") {
      io.to(`class:${socket.roomId}`).emit("class:student_left", { userId: socket.user?._id });
    }
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

httpServer.listen(5001, () => {
  console.log(`Server is running on port ${5001}`);
  connectDB();
});