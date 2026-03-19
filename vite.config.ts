import { defineConfig } from "vite";

export default defineConfig({
  base: "/sts2-sim/",
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
