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
import collabRoutes from "./routes/collab.route.js"; // NEW

import { connectDB } from "./lib/db.js";
import { registerCollabSocketHandlers } from "./lib/collab.socket.js"; // NEW

const app = express();
const PORT = process.env.PORT;

const __dirname = path.resolve();

// NEW: wrap express app in an HTTP server so Socket.io can attach to it
const httpServer = createServer(app);

// NEW: create Socket.io server
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
app.use("/api/collab", collabRoutes); // NEW

// NEW: Socket.io connection handler
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  registerCollabSocketHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

// CHANGED: app.listen → httpServer.listen so Socket.io works
httpServer.listen(5001, () => {
  console.log(`Server is running on port ${5001}`);
  connectDB();
});