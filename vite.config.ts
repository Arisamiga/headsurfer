import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { allowedHosts: [".manus.computer"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "three/examples/jsm/loaders/GLTFLoader.js", "three/examples/jsm/libs/meshopt_decoder.module.js"],
          vision: ["@mediapipe/tasks-vision"],
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
