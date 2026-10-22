# CodeTogether — MERN + Socket.IO single-service image
# Frontend is built to static files and served by the Express backend (same origin),
# so WebSockets, /api and the httpOnly cookie all work together.

FROM node:22-slim AS build

WORKDIR /app

# ── Frontend ───────────────────────────────────────────────────────────────────
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend

# Public, build-time values baked into the bundle (NOT server secrets).
# Pass with: docker build --build-arg VITE_STREAM_API_KEY=... --build-arg VITE_GITHUB_CLIENT_ID=...
ARG VITE_STREAM_API_KEY
ARG VITE_GITHUB_CLIENT_ID
ENV VITE_STREAM_API_KEY=$VITE_STREAM_API_KEY
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID

RUN cd frontend && npm run build

# ── Backend ────────────────────────────────────────────────────────────────────
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
# Reuse the freshly built frontend from /app/frontend/dist
# (server resolves ../frontend/dist relative to /app/backend).

ENV NODE_ENV=production
ENV PORT=5001
WORKDIR /app/backend
EXPOSE 5001

CMD ["node", "src/server.js"]
