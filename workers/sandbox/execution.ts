import crypto from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  ExecutionContext,
  Mustard,
  type Capability,
  type StructuredValue,
} from "mustardscript";

import type {
  SandboxRunRequest,
  SandboxRunResult,
} from "../../shared/sandbox_types";

const MAX_READ_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_FULL_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_LIST_ENTRIES = 1_000;
const DENIED_PATH =
  /(^|[/\\])(?:\.git|\.dyad|node_modules|\.ssh|\.aws|\.config)(?:[/\\]|$)|(^|[/\\])(?:\.env(?:\.[^/\\]+)*|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc)$|\.(?:key|pem)$/i;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

interface AttachmentManifestEntry {
  logicalName: string;
  storedFileName: string;
}

interface ReadOptions {
  start?: number;
  length?: number;
  encoding?: "utf8" | "base64";
}

interface CapabilityState {
  accessedAttachments: boolean;
}

function validateGuestPath(guestPath: string): void {
  if (!guestPath || typeof guestPath !== "string") {
    throw new Error("A relative app path is required.");
  }
  if (
    path.isAbsolute(guestPath) ||
    /^[A-Za-z]:[/\\]/.test(guestPath) ||
    guestPath.startsWith("~/") ||
    guestPath.startsWith("\\\\") ||
    /(^|[/\\])\.\.([/\\]|$)/.test(guestPath)
  ) {
    throw new Error("Sandbox paths must stay inside the app directory.");
  }
  if (DENIED_PATH.test(guestPath)) {
    throw new Error(`Sandbox access to protected path is denied: ${guestPath}`);
  }
}

async function resolveContainedPath(
  appPath: string,
  guestPath: string,
): Promise<string> {
  validateGuestPath(guestPath);
  const [realAppPath, realTargetPath] = await Promise.all([
    fs.realpath(appPath),
    fs.realpath(path.resolve(appPath, guestPath)),
  ]);
  const relative = path.relative(realAppPath, realTargetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Sandbox paths must stay inside the app directory.");
  }
  if (DENIED_PATH.test(relative)) {
    throw new Error(`Sandbox access to protected path is denied: ${guestPath}`);
  }
  return realTargetPath;
}

function mediaDir(appPath: string): string {
  return path.join(appPath, ".dyad", "media");
}

async function readAttachmentManifest(
  appPath: string,
): Promise<AttachmentManifestEntry[]> {
  try {
    const raw = await fs.readFile(
      path.join(mediaDir(appPath), "attachments-manifest.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is AttachmentManifestEntry =>
          Boolean(
            entry &&
            typeof entry === "object" &&
            "logicalName" in entry &&
            typeof entry.logicalName === "string" &&
            "storedFileName" in entry &&
            typeof entry.storedFileName === "string",
          ),
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function resolveAttachmentPath(
  appPath: string,
  logicalPath: string,
): Promise<{ candidatePath: string; rootPath: string }> {
  const logicalName = logicalPath.slice("attachments:".length);
  const entry = (await readAttachmentManifest(appPath)).find(
    (candidate) => candidate.logicalName === logicalName,
  );
  if (!entry) throw new Error(`Attachment not found: ${logicalPath}`);
  const root = await fs.realpath(mediaDir(appPath));
  return {
    candidatePath: path.join(root, path.basename(entry.storedFileName)),
    rootPath: root,
  };
}

interface OpenReadableFile {
  handle: FileHandle;
  stat: Stats;
  filePath: string;
}

async function openReadableFile(
  appPath: string,
  guestPath: string,
  state: CapabilityState,
): Promise<OpenReadableFile> {
  let candidatePath: string;
  let rootPath: string;
  let attachment = false;
  if (guestPath.startsWith("attachments:")) {
    state.accessedAttachments = true;
    const resolved = await resolveAttachmentPath(appPath, guestPath);
    candidatePath = resolved.candidatePath;
    rootPath = resolved.rootPath;
    attachment = true;
  } else {
    validateGuestPath(guestPath);
    rootPath = await fs.realpath(appPath);
    candidatePath = path.resolve(appPath, guestPath);
  }

  const handle = await fs.open(candidatePath, "r");
  try {
    const [stat, realFilePath] = await Promise.all([
      handle.stat(),
      fs.realpath(candidatePath),
    ]);
    const resolvedStat = await fs.stat(realFilePath);
    if (stat.dev !== resolvedStat.dev || stat.ino !== resolvedStat.ino) {
      throw new Error("Sandbox file changed while it was being opened.");
    }
    const relative = path.relative(rootPath, realFilePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        attachment
          ? "Attachment path escaped managed storage."
          : "Sandbox paths must stay inside the app directory.",
      );
    }
    if (!attachment && DENIED_PATH.test(relative)) {
      throw new Error(
        `Sandbox access to protected path is denied: ${guestPath}`,
      );
    }
    if (!stat.isFile()) throw new Error(`Path is not a file: ${guestPath}`);
    return { handle, stat, filePath: realFilePath };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function parseOptionalInteger(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`read_file ${name} must be a non-negative integer.`);
  }
  return value;
}

function parseReadOptions(value: StructuredValue | undefined): ReadOptions {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("read_file options must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.encoding !== undefined &&
    record.encoding !== "utf8" &&
    record.encoding !== "base64"
  ) {
    throw new Error("read_file encoding must be 'utf8' or 'base64'.");
  }
  return {
    start: parseOptionalInteger(record.start, "start"),
    length: parseOptionalInteger(record.length, "length"),
    encoding: record.encoding as ReadOptions["encoding"],
  };
}

function buildCapabilities(
  appPath: string,
  state: CapabilityState,
): Record<string, Capability> {
  return {
    read_file: async (
      guestPath: StructuredValue,
      rawOptions?: StructuredValue,
    ) => {
      if (typeof guestPath !== "string") {
        throw new Error("read_file path must be a string.");
      }
      const options = parseReadOptions(rawOptions);
      const { handle, stat } = await openReadableFile(
        appPath,
        guestPath,
        state,
      );
      try {
        const start = options.start ?? 0;
        const remaining = Math.max(0, stat.size - start);
        const length = options.length ?? remaining;
        if (length > MAX_READ_BYTES) {
          throw new Error(
            `read_file would exceed the ${MAX_READ_BYTES} byte limit; use start and length to read bounded chunks.`,
          );
        }
        const buffer = Buffer.alloc(Math.min(length, remaining));
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          start,
        );
        const bytes = buffer.subarray(0, bytesRead);
        return (options.encoding ?? "utf8") === "base64"
          ? bytes.toString("base64")
          : bytes.toString("utf8");
      } finally {
        await handle.close();
      }
    },
    list_files: async (guestDir?: StructuredValue) => {
      const dir = guestDir === undefined ? "." : guestDir;
      if (typeof dir !== "string") {
        throw new Error("list_files directory must be a string.");
      }
      if (dir === "attachments" || dir === "attachments:") {
        state.accessedAttachments = true;
        return (await readAttachmentManifest(appPath))
          .slice(0, MAX_LIST_ENTRIES)
          .map((entry) => `attachments:${entry.logicalName}`)
          .sort();
      }
      const dirPath = await resolveContainedPath(appPath, dir);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => !DENIED_PATH.test(entry.name))
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort();
    },
    file_stats: async (guestPath: StructuredValue) => {
      if (typeof guestPath !== "string") {
        throw new Error("file_stats path must be a string.");
      }
      const { handle, stat, filePath } = await openReadableFile(
        appPath,
        guestPath,
        state,
      );
      try {
        return {
          size: stat.size,
          isText: TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
          mtime: stat.mtime.toISOString(),
        };
      } finally {
        await handle.close();
      }
    },
  };
}

function stringify(value: StructuredValue): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value, null, 2);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

async function persistFullOutput(
  appPath: string,
  output: string,
): Promise<string> {
  const hash = crypto
    .createHash("sha256")
    .update(output)
    .digest("hex")
    .slice(0, 16);
  const outputPath = path.join(mediaDir(appPath), `script-output-${hash}.txt`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    truncateUtf8(output, MAX_FULL_OUTPUT_BYTES),
    "utf8",
  );
  return outputPath;
}

export async function executeSandboxScript(
  request: SandboxRunRequest,
): Promise<SandboxRunResult> {
  const startedAt = Date.now();
  const capabilityState: CapabilityState = { accessedAttachments: false };
  const program = new Mustard(request.script, { lenientMode: true });
  const context = new ExecutionContext({
    capabilities: buildCapabilities(request.appPath, capabilityState),
    limits: {
      instructionBudget: 10_000_000,
      heapLimitBytes: 128 * 1024 * 1024,
      allocationBudget: 1_000_000,
      callDepthLimit: 256,
      maxOutstandingHostCalls: 16,
    },
    snapshotKey: `dyad-readonly-sandbox:${request.appPath}`,
  });
  const result = await program.run({
    context,
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const output = stringify(result);
  const truncated = Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES;
  const fullOutputPath =
    truncated && request.persistFullOutput !== false
      ? await persistFullOutput(request.appPath, output)
      : undefined;
  return {
    value: truncated ? truncateUtf8(output, MAX_OUTPUT_BYTES) : output,
    truncated,
    fullOutputPath,
    accessedAttachments: capabilityState.accessedAttachments || undefined,
    executionMs: Date.now() - startedAt,
  };
}
