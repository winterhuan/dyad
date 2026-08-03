import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeSandboxScript } from "../../../workers/sandbox/execution";

describe.runIf(
  (process.platform === "darwin" &&
    (process.arch === "arm64" || process.arch === "x64")) ||
    (process.platform === "linux" && process.arch === "x64") ||
    (process.platform === "win32" && process.arch === "x64"),
)("read-only sandbox execution", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-sandbox-test-"));
    await fs.mkdir(path.join(appPath, "src"));
    await fs.writeFile(path.join(appPath, "src", "data.txt"), "hello");
    await fs.writeFile(path.join(appPath, ".env"), "SECRET=value");
    await fs.mkdir(path.join(appPath, ".dyad", "media"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, ".dyad", "media", "stored-data.csv"),
      "name,total\nalice,42\n",
    );
    await fs.writeFile(
      path.join(appPath, ".dyad", "media", "attachments-manifest.json"),
      JSON.stringify([
        {
          logicalName: "data.csv",
          originalName: "data.csv",
          storedFileName: "stored-data.csv",
          mimeType: "text/csv",
          sizeBytes: 20,
          createdAt: new Date(0).toISOString(),
        },
      ]),
    );
  });

  it("supports attachment paths, byte ranges, and base64 reads", async () => {
    const result = await executeSandboxScript({
      appPath,
      script:
        'const files = await list_files("attachments:"); const value = await read_file("attachments:data.csv", { start: 5, length: 5, encoding: "base64" }); return { files, value };',
      timeoutMs: 2_000,
    });

    expect(result.accessedAttachments).toBe(true);
    expect(result.value).toContain("attachments:data.csv");
    expect(result.value).toContain(Buffer.from("total").toString("base64"));
  });

  it("persists complete output when the model-facing value is truncated", async () => {
    const result = await executeSandboxScript({
      appPath,
      script:
        'let output = "x"; for (let i = 0; i < 19; i++) { output += output; } return output;',
      timeoutMs: 5_000,
      persistFullOutput: true,
    });

    expect(result.truncated).toBe(true);
    expect(result.fullOutputPath).toBeTruthy();
    expect((await fs.stat(result.fullOutputPath!)).size).toBe(524_288);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("runs bounded guest code and exposes explicit read capabilities", async () => {
    await expect(
      executeSandboxScript({
        appPath,
        script:
          'const text = await read_file("src/data.txt"); return { text, files: await list_files("src") };',
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({
      value: expect.stringContaining('"text": "hello"'),
      truncated: false,
    });
  });

  it("does not expose Node globals or protected files", async () => {
    await expect(
      executeSandboxScript({
        appPath,
        script: "return process.env;",
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
    await expect(
      executeSandboxScript({
        appPath,
        script: 'return await read_file(".env");',
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("protected path");
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlinks that leave the app",
    async () => {
      const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), "dyad-sandbox-outside-"),
      );
      try {
        await fs.writeFile(path.join(outside, "secret.txt"), "secret");
        await fs.symlink(outside, path.join(appPath, "outside"), "dir");
        await expect(
          executeSandboxScript({
            appPath,
            script: 'return await read_file("outside/secret.txt");',
            timeoutMs: 2_000,
          }),
        ).rejects.toThrow("inside the app");
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );
});
