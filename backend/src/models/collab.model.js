import mongoose from "mongoose";

const collabSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // The user who connected their GitHub account for this collab
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
    // Status of the collab: pending | active | closed
    status: {
      type: String,
      enum: ["pending", "active", "closed"],
      default: "pending",
    },
    // who sent the collab request
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Control access: which user currently has edit permission shared
    // null = no sharing, otherwise the userId who is viewing
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
