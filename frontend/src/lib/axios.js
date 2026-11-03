
import axios from "axios";

export const BACKEND_ORIGIN =
    import.meta.env.MODE === "development"
        ? "http://localhost:5001"
        : import.meta.env.VITE_BACKEND_URL || "https://code-together-api.onrender.com";

const BASE_URL =
    import.meta.env.MODE === "development"
        ? `${BACKEND_ORIGIN}/api`
        : "/api";

export const axiosInstance = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
});
