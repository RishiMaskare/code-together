import mongoose from "mongoose";

const meetingMessageSchema = new mongoose.Schema(
  {
    meeting: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meeting",
      required: true,
      index: true,
    },
    // Identity is derived from the authenticated socket, never from the payload.
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName: { type: String, default: "" },
    senderAvatar: { type: String, default: "" },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: [2000, "Message is too long"],
    },
  },
  { timestamps: true }
);

meetingMessageSchema.index({ meeting: 1, createdAt: -1 });

const MeetingMessage = mongoose.model("MeetingMessage", meetingMessageSchema);
export default MeetingMessage;
