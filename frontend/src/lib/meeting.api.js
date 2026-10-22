import { axiosInstance } from "./axios.js";

// ── Room-scoped ──────────────────────────────────────────────────────────────
export const startMeeting = (roomId) =>
  axiosInstance.post(`/rooms/${roomId}/meetings/start`).then((r) => r.data);

export const getActiveMeeting = (roomId) =>
  axiosInstance.get(`/rooms/${roomId}/meetings/active`).then((r) => r.data);

// ── Meeting-scoped lifecycle ─────────────────────────────────────────────────
export const requestJoin = (meetingId) =>
  axiosInstance.post(`/meetings/${meetingId}/join-request`).then((r) => r.data);

export const admitParticipant = (meetingId, userId) =>
  axiosInstance.post(`/meetings/${meetingId}/admit/${userId}`).then((r) => r.data);

export const declineParticipant = (meetingId, userId) =>
  axiosInstance.post(`/meetings/${meetingId}/decline/${userId}`).then((r) => r.data);

export const removeParticipant = (meetingId, userId) =>
  axiosInstance.post(`/meetings/${meetingId}/remove/${userId}`).then((r) => r.data);

export const leaveMeeting = (meetingId) =>
  axiosInstance.post(`/meetings/${meetingId}/leave`).then((r) => r.data);

export const setMeetingLock = (meetingId, locked) =>
  axiosInstance.patch(`/meetings/${meetingId}/lock`, { locked }).then((r) => r.data);

export const endMeeting = (meetingId) =>
  axiosInstance.post(`/meetings/${meetingId}/end`).then((r) => r.data);

// ── Authorization-gated resources ────────────────────────────────────────────
export const getMediaToken = (meetingId) =>
  axiosInstance.get(`/meetings/${meetingId}/media-token`).then((r) => r.data);

export const getMeetingMessages = (meetingId, params = {}) =>
  axiosInstance
    .get(`/meetings/${meetingId}/messages`, { params })
    .then((r) => r.data);
