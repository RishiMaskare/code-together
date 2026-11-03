export function createCorsOptions({
  frontendUrl = process.env.FRONTEND_URL,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const allowedFrontendOrigin = frontendUrl
    ? new URL(frontendUrl).origin
    : undefined;
  const allowLocalOrigins = nodeEnv !== "production";

  return {
    credentials: true,
    origin(origin, callback) {
      const isLocalOrigin =
        allowLocalOrigins &&
        /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || "");

      callback(
        null,
        !origin || origin === allowedFrontendOrigin || isLocalOrigin
      );
    },
  };
}
