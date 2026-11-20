import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
export default defineConfig({
  build: { outDir: "dist/client" },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    watch: { ignored: ["**/data/**", "**/releases/**", "**/runtime/**", "**/.studio/**"] },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/.git/**",
        "**/.studio/**",
        "**/data/**",
        "**/releases/**",
        "**/runtime/**",
      ],
    },
  },
  plugins: [
    react(),
    {
      name: "studio-build-version",
      apply: "build",
      generateBundle() {
        let revision = process.env.STUDIO_BUILD_REVISION;
        if (!revision && existsSync(".git")) {
          try { revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
          catch { return; }
        }
        if (/^[a-f0-9]{40}$/.test(revision)) this.emitFile({ type: "asset", fileName: "studio-version.json", source: JSON.stringify({ revision }) });
      },
    },
    {
      name: "local-studio-api",
      async configureServer(server) {
        const { studioApi } = await import("./server/api.mjs");
        server.middlewares.use(studioApi());
      },
      async configurePreviewServer(server) {
        const { studioApi } = await import("./server/api.mjs");
        server.middlewares.use(studioApi());
      },
    },
  ],
});
