import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePetHealth, loadLocalEnv, readJsonBody } from "./server/deepseek.js";
import { isPathInsideDirectory, requireAiRequestAllowed } from "./server/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const distDir = path.join(root, "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

loadLocalEnv(root);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

async function serveStatic(req, res) {
  let pathname;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  const filePath = path.normalize(path.join(distDir, pathname === "/" ? "index.html" : pathname));
  if (!isPathInsideDirectory(distDir, filePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  } catch {
    const fallback = await fs.readFile(path.join(distDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/health-analysis" && req.method === "POST") {
    try {
      requireAiRequestAllowed(req);
      const body = await readJsonBody(req);
      const result = await analyzePetHealth(body);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.statusCode || 500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message || "AI analysis failed" }));
    }
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`CareGuard server listening on http://${host}:${port}`);
});
