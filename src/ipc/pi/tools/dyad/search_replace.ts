import fs from "node:fs";
import { z } from "zod";
import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { applySearchReplace } from "@/ipc/processors/search_replace_processor";
import { withLock, getFileWriteKey } from "@/ipc/utils/lock_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { escapeSearchReplaceMarkers } from "@/shared/search_replace_markers";
import { deploySupabaseFunction } from "@/supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "@/supabase_admin/supabase_utils";
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";

const logger = log.scope("search_replace");

const searchReplaceSchema = z.object({
  file_path: z
    .string()
    .describe("The path to the file you want to search and replace in."),
  old_string: z
    .string()
    .describe(
      "The text block to replace. Matching is line-based: each line in old_string must match a whole line in the file, not just a substring within a line. To edit part of a line, include the entire original line. The block must be unique within the file.",
    ),
  new_string: z
    .string()
    .describe(
      "The edited text to replace old_string. It must be different from old_string.",
    ),
});

export const searchReplaceTool: ToolDefinition<
  z.infer<typeof searchReplaceSchema>
> = {
  name: "search_replace",
  description: `Replace one uniquely matching block in an existing file.

Matching is line-based: old_string must contain whole file lines, not a partial fragment within a line. Include enough surrounding lines to make old_string unique. Use separate calls for distinct regions.`,
  inputSchema: searchReplaceSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Edit ${args.file_path}`,

  buildXml: (args, isComplete) => {
    if (!args.file_path) return undefined;

    const escapedOld = escapeSearchReplaceMarkers(args.old_string ?? "");
    let xml = `<dyad-search-replace path="${escapeXmlAttr(args.file_path)}" description="">\n<<<<<<< SEARCH\n${escapeXmlContent(escapedOld)}`;
    if (args.new_string !== undefined) {
      const escapedNew = escapeSearchReplaceMarkers(args.new_string);
      xml += `\n=======\n${escapeXmlContent(escapedNew)}`;
    }
    if (isComplete) {
      if (args.new_string === undefined) xml += "\n=======\n";
      xml += "\n>>>>>>> REPLACE\n</dyad-search-replace>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    if (args.old_string === args.new_string) {
      throw new DyadError(
        "old_string and new_string must be different",
        DyadErrorKind.Validation,
      );
    }

    const operationPath = await assertMutationPathAllowed({
      appPath: ctx.appPath,
      relativePath: args.file_path,
    });
    const fullFilePath = safeJoin(ctx.appPath, operationPath);

    if (isSharedServerModule(operationPath)) {
      ctx.isSharedModulesChanged = true;
      ctx.sharedServerModulePaths.push(operationPath);
    }

    await withLock(getFileWriteKey(fullFilePath), async () => {
      if (!fs.existsSync(fullFilePath)) {
        throw new DyadError(
          `File does not exist: ${args.file_path}`,
          DyadErrorKind.NotFound,
        );
      }

      const original = await fs.promises.readFile(fullFilePath, "utf8");
      const operations = `<<<<<<< SEARCH\n${escapeSearchReplaceMarkers(args.old_string)}\n=======\n${escapeSearchReplaceMarkers(args.new_string)}\n>>>>>>> REPLACE`;
      const result = applySearchReplace(original, operations);
      if (!result.success || typeof result.content !== "string") {
        throw new DyadError(
          `Failed to apply search-replace: ${result.error ?? "unknown"}`,
          DyadErrorKind.Validation,
        );
      }

      await fs.promises.writeFile(fullFilePath, result.content);
      logger.log(`Successfully applied search-replace to: ${fullFilePath}`);
    });

    if (ctx.supabaseProjectId && isServerFunction(operationPath)) {
      try {
        const functionName = extractFunctionNameFromPath(operationPath);
        if (!ctx.isSharedModulesChanged) {
          await deploySupabaseFunction({
            supabaseProjectId: ctx.supabaseProjectId,
            functionName,
            appPath: ctx.appPath,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
            signal: ctx.abortSignal,
          });
        } else {
          ctx.pendingFunctionDeploys.push(functionName);
        }
      } catch (error) {
        ctx.abortSignal?.throwIfAborted();
        return `Search-replace applied, but failed to deploy Supabase function: ${error}`;
      }
    }

    return `Successfully applied edits to ${args.file_path}`;
  },
};
