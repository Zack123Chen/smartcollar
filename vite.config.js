import { defineConfig } from "vite";
import { analyzePetHealth, loadLocalEnv, readJsonBody } from "./server/deepseek.js";

loadLocalEnv();

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/smartcollar/" : "/",
  plugins: [
    {
      name: "careguard-health-api",
      configureServer(server) {
        server.middlewares.use("/api/health-analysis", async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
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
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
