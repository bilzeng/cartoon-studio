import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  build: { outDir: "dist/client" },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    watch: { ignored: ["**/data/**", "**/releases/**", "**/runtime/**"] },
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
