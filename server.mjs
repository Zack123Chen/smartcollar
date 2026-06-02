import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePetHealth, loadLocalEnv, readJsonBody } from "./server/deepseek.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const distDir = path.join(root, "dist");
const port = Number(process.env.PORT || 8787);

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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(distDir, pathname === "/" ? "index.html" : pathname));
  if (!filePath.startsWith(distDir)) {
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

server.listen(port, () => {
  console.log(`CareGuard server listening on http://localhost:${port}`);
});
