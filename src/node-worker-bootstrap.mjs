// Bootstrap for Node.js worker thread.
// tsx's execArgv approach doesn't remap .js -> .ts imports in Node 24 workers.
// tsImport() handles the full TypeScript resolution chain correctly.
import { tsImport } from "tsx/esm/api";
await tsImport("./node-worker.ts", import.meta.url);
