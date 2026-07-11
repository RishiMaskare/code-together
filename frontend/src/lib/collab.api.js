import { axiosInstance } from "./axios.js";

// ── Collab requests ───────────────────────────────────────────────────────────

export const sendCollabRequest = (friendId) =>
  axiosInstance.post(`/collab/request/${friendId}`).then((r) => r.data);

export const acceptCollabRequest = (collabId) =>
  axiosInstance.put(`/collab/accept/${collabId}`).then((r) => r.data);

export const rejectCollabRequest = (collabId) =>
  axiosInstance.put(`/collab/reject/${collabId}`).then((r) => r.data);

export const getMyCollabs = () =>
  axiosInstance.get("/collab").then((r) => r.data);

export const getCollabById = (collabId) =>
  axiosInstance.get(`/collab/${collabId}`).then((r) => r.data);

// ── GitHub ────────────────────────────────────────────────────────────────────

export const disconnectGithub = () =>
  axiosInstance.post("/collab/github/disconnect").then((r) => r.data);

// localFiles: [{ path: "main.js", content: "..." }, ...]
// All local files are pushed to GitHub in one commit on repo creation
export const createCollabRepo = (collabId, repoName, localFiles = []) =>
  axiosInstance
    .post(`/collab/repo/${collabId}`, { repoName, localFiles })
    .then((r) => r.data);

// ── Repo file operations ──────────────────────────────────────────────────────

export const getRepoFiles = (collabId, path = "") =>
  axiosInstance
    .get(`/collab/repo/${collabId}/files`, { params: { path } })
    .then((r) => r.data);

export const getFileContent = (collabId, path) =>
  axiosInstance
    .get(`/collab/repo/${collabId}/file`, { params: { path } })
    .then((r) => r.data);

export const commitFile = (collabId, { path, content, message, sha }) =>
  axiosInstance
    .post(`/collab/repo/${collabId}/commit`, { path, content, message, sha })
    .then((r) => r.data);