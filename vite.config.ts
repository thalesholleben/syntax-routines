/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5190,
    // changeOrigin reescreve o Host para 127.0.0.1:4090, que e o que a guarda de Host aceita.
    proxy: { "/api": { target: "http://127.0.0.1:4090", changeOrigin: true } }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  },
  test: {
    include: ["server/src/**/*.test.ts", "scripts/**/*.test.ts"]
  }
});
