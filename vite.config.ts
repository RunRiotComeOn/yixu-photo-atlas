import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/yixu-photo-atlas/",
  build: { sourcemap: true },
});
