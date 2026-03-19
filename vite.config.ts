import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  esbuild: {
    tsconfig: "tsconfig.web.json",
  },
});
