import path from "node:path";

function normalizeRemoteAddress(address = "") {
  return String(address).replace(/^::ffff:/, "");
}

export function isLoopbackAddress(address = "") {
  const normalized = normalizeRemoteAddress(address);
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

export function isPathInsideDirectory(directory, filePath) {
  const relativePath = path.relative(directory, filePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function isSameOriginRequest(req) {
  const host = req.headers.host;
  if (!host) return false;

  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return false;
}

export function isAiRequestAllowed(req) {
  const remoteAddress = req.socket?.remoteAddress || "";
  return isLoopbackAddress(remoteAddress) || isSameOriginRequest(req);
}

export function requireAiRequestAllowed(req) {
  if (isAiRequestAllowed(req)) return;

  const error = new Error("Forbidden AI analysis request");
  error.statusCode = 403;
  throw error;
}
