export interface SandboxRunRequest {
  appPath: string;
  script: string;
  timeoutMs: number;
  persistFullOutput?: boolean;
}

export interface SandboxRunResult {
  value: string;
  truncated: boolean;
  fullOutputPath?: string;
  accessedAttachments?: boolean;
  executionMs: number;
}

export type SandboxWorkerMessage =
  | { type: "result"; result: SandboxRunResult }
  | { type: "error"; message: string };
