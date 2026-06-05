import { defineConfig } from "vite";
import { analyzePetHealth, loadLocalEnv, readJsonBody } from "./server/deepseek.js";
import { handleMiniRelay } from "./server/miniRelay.js";
import { handleAlertNotification } from "./server/notify.js";
import { requireAiRequestAllowed } from "./server/security.js";

loadLocalEnv();

const devHost = process.env.HOST || "127.0.0.1";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/smartcollar/" : "/",
  plugins: [
    {
      name: "careguard-health-api",
      configureServer(server) {
        server.middlewares.use("/api/mini-relay", async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            requireAiRequestAllowed(req);
            const result = await handleMiniRelay(req);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = error.statusCode || 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: error.message || "Mini program relay failed" }));
          }
        });

        server.middlewares.use("/api/alert-notify", async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            requireAiRequestAllowed(req);
            const result = await handleAlertNotification(req);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = error.statusCode || 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: error.message || "Alert notification failed" }));
          }
        });

        server.middlewares.use("/api/health-analysis", async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            requireAiRequestAllowed(req);
            const body = await readJsonBody(req);
            const result = await analyzePetHealth(body);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = error.statusCode || 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: error.message || "AI analysis failed" }));
          }
        });
      }
    }
  ],
  build: {
    chunkSizeWarningLimit: 900
  },
  server: {
    host: devHost,
    port: 5173
  },
  preview: {
    host: devHost,
    port: 4173
  }
});
