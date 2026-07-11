import mongoose from "mongoose";

const collabSchema = new mongoose.Schema(
  {
    // NEW: Differentiate between 1on1 and team collabs
    type: {
      type: String,
      enum: ["1on1", "team"],
      default: "1on1",
    },
    teamName: {
      type: String,
      default: null,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    githubOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    githubRepoName: {
      type: String,
      default: null,
    },
    githubRepoUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "active", "closed"],
      default: "pending",
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    activeScreenShare: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const Collab = mongoose.model("Collab", collabSchema);
export default Collab;