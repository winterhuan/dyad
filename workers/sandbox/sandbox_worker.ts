import { parentPort, workerData } from "node:worker_threads";

import type {
  SandboxRunRequest,
  SandboxWorkerMessage,
} from "../../shared/sandbox_types";
import { executeSandboxScript } from "./execution";

if (!parentPort) {
  throw new Error("Sandbox worker must run inside a worker thread.");
}

const port = parentPort;
void executeSandboxScript(workerData as SandboxRunRequest).then(
  (result) => {
    port.postMessage({ type: "result", result } satisfies SandboxWorkerMessage);
  },
  (error) => {
    port.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies SandboxWorkerMessage);
  },
);
