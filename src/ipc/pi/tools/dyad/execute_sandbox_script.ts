import { z } from "zod";

import {
  isSandboxScriptSupported,
  runSandboxScript,
} from "@/ipc/processors/sandbox";
import { escapeXmlAttr, escapeXmlContent, type ToolDefinition } from "./types";

const executeSandboxScriptSchema = z.object({
  script: z
    .string()
    .min(1)
    .max(128 * 1024),
  description: z.string().trim().max(200).optional(),
  timeout_ms: z.number().int().min(1).max(60_000).optional(),
});

export const executeSandboxScriptTool: ToolDefinition<
  z.infer<typeof executeSandboxScriptSchema>
> = {
  name: "execute_sandbox_script",
  description: `Run bounded MustardScript code for local data processing.

- The language is a deliberately limited JavaScript subset with arrays, objects, loops, functions, JSON, Math, async/await, Map, and Set.
- There is no process, environment, module import, network, timer, subprocess, or ambient filesystem access.
- Read-only app capabilities are read_file(path, { start?, length?, encoding? }), list_files(directory?), and file_stats(path). Use attachment paths such as attachments:data.csv; list_files("attachments:") lists available attachments. Protected files such as .env, credentials, .git, .dyad, and node_modules are denied.
- Return the final value from the script. Use this for bounded transformations or analysis that would otherwise require many tool calls.`,
  inputSchema: executeSandboxScriptSchema,
  defaultConsent: "always",
  isEnabled: () => isSandboxScriptSupported(),
  getConsentPreview: (args) =>
    args.description || "Run a read-only sandbox script",
  buildXml: (args, isComplete) =>
    !isComplete && args.description
      ? `<dyad-script description="${escapeXmlAttr(args.description)}">`
      : undefined,
  execute: async (args, ctx) => {
    const result = await runSandboxScript({
      appPath: ctx.appPath,
      script: args.script,
      timeoutMs: args.timeout_ms,
      signal: ctx.abortSignal,
    });
    if (result.accessedAttachments) ctx.onAttachmentAccess?.();
    const payload = JSON.stringify({
      script: args.script,
      output: result.value,
    });
    const attrs = [
      `description="${escapeXmlAttr(args.description || "Ran a read-only script")}"`,
      `execution_ms="${result.executionMs}"`,
      ...(result.truncated ? ['truncated="true"'] : []),
      ...(result.fullOutputPath
        ? [`full_output_path="${escapeXmlAttr(result.fullOutputPath)}"`]
        : []),
    ];
    ctx.onXmlComplete(
      `<dyad-script ${attrs.join(" ")}>${escapeXmlContent(payload)}</dyad-script>`,
    );
    return JSON.stringify(result);
  },
};
