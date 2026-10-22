import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    avatar: { type: String, default: "" },
    role: { type: String, enum: ["host", "participant"], default: "participant" },
    // Admission + presence state machine
    state: {
      type: String,
      enum: ["requested", "admitted", "declined", "left", "removed"],
      default: "requested",
    },
    joinedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    // Which kind of CodeTogether room this meeting belongs to.
    // Kept generic so other room types (classroom, whiteboard) can reuse it.
    roomType: { type: String, enum: ["collab"], default: "collab" },

    // The persisted room (Collab) this meeting is attached to.
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collab",
      required: true,
    },

    // Stream Video call id for this meeting.
    streamCallId: { type: String, required: true },

    // Server-derived host (the room's requester/owner). Never taken from the client.
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    status: { type: String, enum: ["active", "ended"], default: "active" },

    // Host can stop new join requests.
    isLocked: { type: String, enum: ["open", "locked"], default: "open" },

    participants: { type: [participantSchema], default: [] },

    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Enforce at most ONE active meeting per room.
meetingSchema.index(
  { roomId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

// Fast lookup of the active meeting for a room, and of ended history.
meetingSchema.index({ roomId: 1, status: 1, createdAt: -1 });

const Meeting = mongoose.model("Meeting", meetingSchema);
export default Meeting;
