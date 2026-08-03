import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "workers/sandbox/sandbox_worker.ts"),
      name: "sandbox_worker",
      fileName: "sandbox_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [...nodeBuiltins, "mustardscript"],
    },
  },
});
