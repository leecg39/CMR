import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/console",
  plugins: [react()],
  build: { outDir: "../../dist/console", emptyOutDir: true },
  server: {
    port: 5178,
    proxy: {
      "/v1": "http://127.0.0.1:4310",
      "/sdk": "http://127.0.0.1:4310",
      "/demo": "http://127.0.0.1:4310",
    },
  },
});
