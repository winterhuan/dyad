import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  SandboxRunRequest,
  SandboxRunResult,
  SandboxWorkerMessage,
} from "../../../shared/sandbox_types";

const MAX_SCRIPT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

function isSupportedPlatform(): boolean {
  return (
    (process.platform === "darwin" &&
      (process.arch === "arm64" || process.arch === "x64")) ||
    (process.platform === "linux" && process.arch === "x64") ||
    (process.platform === "win32" && process.arch === "x64")
  );
}

export function isSandboxScriptSupported(): boolean {
  return isSupportedPlatform();
}

function workerPath(): string | undefined {
  const candidate = path.join(__dirname, "sandbox_worker.js");
  if (fs.existsSync(candidate)) return candidate;
  return undefined;
}

export async function runSandboxScript(params: {
  appPath: string;
  script: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SandboxRunResult> {
  if (!isSupportedPlatform()) {
    throw new DyadError(
      "Sandbox scripting is unavailable on this platform.",
      DyadErrorKind.Precondition,
    );
  }
  if (Buffer.byteLength(params.script, "utf8") > MAX_SCRIPT_BYTES) {
    throw new DyadError(
      "Sandbox script is too large.",
      DyadErrorKind.Validation,
    );
  }
  const timeoutMs = Math.min(
    Math.max(Math.floor(params.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1),
    MAX_TIMEOUT_MS,
  );
  const request: SandboxRunRequest = {
    appPath: params.appPath,
    script: params.script,
    timeoutMs,
    persistFullOutput: true,
  };
  const target = workerPath();
  if (!target) {
    if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
      const { executeSandboxScript } =
        await import("../../../workers/sandbox/execution");
      return executeSandboxScript(request);
    }
    throw new DyadError(
      "Sandbox worker script is missing from the application build.",
      DyadErrorKind.Internal,
    );
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(target, { workerData: request });
    let settled = false;
    const timer = setTimeout(() => {
      settle(
        () =>
          reject(
            new DyadError(
              `Sandbox script timed out after ${timeoutMs}ms.`,
              DyadErrorKind.External,
            ),
          ),
        true,
      );
    }, timeoutMs + 1_000);
    const onAbort = () => {
      settle(
        () =>
          reject(
            new DyadError(
              "Sandbox script was cancelled.",
              DyadErrorKind.UserCancelled,
            ),
          ),
        true,
      );
    };

    function cleanup() {
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    }
    function settle(callback: () => void, terminate: boolean) {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
      if (terminate) void worker.terminate();
    }

    params.signal?.addEventListener("abort", onAbort, { once: true });
    if (params.signal?.aborted) {
      onAbort();
      return;
    }
    worker.on("message", (message: SandboxWorkerMessage) => {
      if (message.type === "result") {
        settle(() => resolve(message.result), true);
      } else {
        settle(
          () =>
            reject(new DyadError(message.message, DyadErrorKind.Validation)),
          true,
        );
      }
    });
    worker.on("error", (error) => settle(() => reject(error), true));
    worker.on("exit", (code) => {
      settle(
        () =>
          reject(
            new DyadError(
              `Sandbox worker exited before returning a result (${code}).`,
              DyadErrorKind.Internal,
            ),
          ),
        false,
      );
    });
  });
}
