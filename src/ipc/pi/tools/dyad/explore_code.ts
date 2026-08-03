import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { CodeExplorerResult } from "../../../../../shared/code_explorer_types";
import {
  formatCodeExplorerDisabledReason,
  getCodeExplorerAvailability,
} from "@/ipc/processors/code_explorer";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type AgentContext,
  type ToolDefinition,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import {
  exploreCodeSchema,
  formatRawExploreCodeResult,
  normalizeExploreCodeArgsForApp,
  runRawExploreCode,
} from "./explore_code_raw";
import { runExploreCodeSubagent } from "./explore_code_subagent";

export function validateCodeExplorerReport(
  report: string,
  result: CodeExplorerResult,
): boolean {
  const citations = [...report.matchAll(/\[\[file:(.+?)#L(\d+)-L(\d+)\]\]/g)];
  if (result.files.length > 0 && citations.length === 0) return false;
  return citations.every((match) => {
    const file = result.files.find((candidate) => candidate.path === match[1]);
    if (!file) return false;
    const start = Number(match[2]);
    const end = Number(match[3]);
    return file.windows.some(
      (window) => start >= window.startLine && end <= window.endLine,
    );
  });
}

function buildAttributes(
  args: Partial<z.infer<typeof exploreCodeSchema>>,
  result?: {
    files: unknown[];
    totalSymbols: number;
    indexMs: number;
    searchMs: number;
    truncated: boolean;
  },
): string {
  const attrs: string[] = [];
  if (args.query) attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (result) {
    attrs.push(`files="${result.files.length}"`);
    attrs.push(`symbols="${result.totalSymbols}"`);
    attrs.push(`index_ms="${result.indexMs}"`);
    attrs.push(`search_ms="${result.searchMs}"`);
    if (result.truncated) attrs.push(`truncated="true"`);
  }
  return attrs.join(" ");
}

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof exploreCodeSchema>
> = {
  name: "explore_code",
  description:
    "Use the TypeScript compiler to map relevant symbols, files, line ranges, and nearby call relationships. Use this for broad code reconnaissance when grep/list/read are not enough; use the returned paths and ranges as the next read targets.",
  inputSchema: exploreCodeSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => getCodeExplorerAvailability(ctx.appPath).ready,
  getConsentPreview: (args) => `Explore code for "${args.query}"`,
  buildXml: (args, isComplete) => {
    if (isComplete || !args.query) return undefined;
    return `<dyad-explore-code ${buildAttributes(args)}>Exploring...`;
  },
  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const availability = getCodeExplorerAvailability(targetAppPath);
    if (!availability.ready) {
      throw new DyadError(
        formatCodeExplorerDisabledReason(availability),
        DyadErrorKind.Precondition,
      );
    }
    const effectiveArgs = normalizeExploreCodeArgsForApp({
      appPath: targetAppPath,
      args,
      fallbackTsconfigPath: availability.tsconfigPath,
    });
    ctx.onXmlStream(
      `<dyad-explore-code ${buildAttributes(effectiveArgs)}>Exploring...`,
    );
    ctx.abortSignal?.throwIfAborted();
    const result = await runRawExploreCode({
      appPath: targetAppPath,
      args: effectiveArgs,
    });
    ctx.abortSignal?.throwIfAborted();
    const rawText = formatRawExploreCodeResult(result);
    let text: string;
    try {
      text =
        (await runExploreCodeSubagent({
          args: effectiveArgs,
          ctx,
          initialResult: result,
          onProgress: (steps) =>
            ctx.onXmlStream(
              `<dyad-explore-code ${buildAttributes(effectiveArgs)}>Exploring... (${steps} read-only steps)`,
            ),
        })) ?? rawText;
    } catch (error) {
      if (ctx.abortSignal?.aborted) throw error;
      text = `Synthesis unavailable; returning compiler-observed results.\n\n${rawText}`;
    }
    ctx.onXmlComplete(
      `<dyad-explore-code ${buildAttributes(effectiveArgs, result)}>${escapeXmlContent(text)}</dyad-explore-code>`,
    );
    return text;
  },
};
