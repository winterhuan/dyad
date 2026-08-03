import type { AgentTool } from "@earendil-works/pi-agent-core";
import { z } from "zod";

import type { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { createDyadAgent } from "../agent_factory";
import { adaptTool, zodToTypebox } from "../tools/adapter";
import {
  toolModifiesState,
  type AgentContext,
  type ToolDefinition,
} from "../tools/dyad/types";

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 24;
const DEFAULT_MAX_OBSERVATION_CHARS = 120_000;
const DEFAULT_MAX_OBSERVATION_CHARS_PER_TOOL = 20_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 4_000;

export interface ReadOnlySubagentObservation {
  toolName: string;
  args: unknown;
  result: string;
}

export type ReadOnlySubagentStatus =
  | "submitted"
  | "no_report"
  | "provider_error"
  | "timeout";

export interface ReadOnlySubagentResult<TReport> {
  status: ReadOnlySubagentStatus;
  report?: TReport;
  observations: ReadOnlySubagentObservation[];
  turns: number;
  toolCalls: number;
  errorMessage?: string;
}

export interface ReportValidation<TReport> {
  accepted: boolean;
  feedback: string;
  report?: TReport;
}

export interface RunReadOnlySubagentOptions<TReportInput, TReport> {
  ctx: AgentContext;
  systemPrompt: string;
  prompt: string;
  tools: readonly ToolDefinition[];
  reportSchema: z.ZodType<TReportInput>;
  validateReport: (report: TReportInput) => ReportValidation<TReport>;
  onObservation?: (observation: ReadOnlySubagentObservation) => void;
  model?: LargeLanguageModel;
  maxTurns?: number;
  maxToolCalls?: number;
  maxObservationChars?: number;
  maxObservationCharsPerTool?: number;
  initialObservationChars?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = "\n[TRUNCATED: sub-agent observation budget]";
  if (maxChars <= suffix.length) return suffix.slice(0, maxChars);
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function createInvocationContext(
  parent: AgentContext,
  signal?: AbortSignal,
): AgentContext {
  return {
    ...parent,
    referencedApps: new Map(parent.referencedApps),
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    todos: [],
    fileEditTracker: {},
    workspaceMutated: false,
    mutationCount: 0,
    testRunAttempts: new Map(),
    testRunCount: 0,
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: async () => true,
    appendUserMessage: () => {},
    onUpdateTodos: () => {},
    onWarningMessage: undefined,
    onAttachmentAccess: () => {},
    abortSignal: signal,
  };
}

function createReportTool<TReportInput, TReport>(params: {
  schema: z.ZodType<TReportInput>;
  validate: (report: TReportInput) => ReportValidation<TReport>;
  onAccepted: (report: TReport) => void;
}): AgentTool {
  return {
    name: "submit_report",
    label: "Submit report",
    description:
      "Submit the final evidence-grounded report. Use only references observed in tool results.",
    parameters: zodToTypebox(params.schema),
    executionMode: "sequential",
    async execute(_toolCallId, value) {
      const parsed = params.schema.safeParse(value);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text",
              text: `Report rejected: ${parsed.error.message}`,
            },
          ],
          details: {},
        };
      }
      const validation = params.validate(parsed.data);
      if (validation.accepted && validation.report !== undefined) {
        params.onAccepted(validation.report);
      }
      return {
        content: [{ type: "text", text: validation.feedback }],
        details: {},
        terminate: validation.accepted,
      };
    },
  };
}

export async function runReadOnlySubagent<TReportInput, TReport>(
  options: RunReadOnlySubagentOptions<TReportInput, TReport>,
): Promise<ReadOnlySubagentResult<TReport>> {
  options.ctx.abortSignal?.throwIfAborted();

  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxObservationChars =
    options.maxObservationChars ?? DEFAULT_MAX_OBSERVATION_CHARS;
  const maxObservationCharsPerTool =
    options.maxObservationCharsPerTool ??
    DEFAULT_MAX_OBSERVATION_CHARS_PER_TOOL;
  const observations: ReadOnlySubagentObservation[] = [];
  let observedChars = Math.max(0, options.initialObservationChars ?? 0);
  let acceptedReport: TReport | undefined;
  let turns = 0;
  let toolCalls = 0;
  let timedOut = false;

  const readOnlyTools = options.tools.map((tool) => {
    if (toolModifiesState(tool, options.ctx)) {
      throw new Error(
        `Refusing to expose state-modifying tool "${tool.name}" to a read-only sub-agent.`,
      );
    }
    const wrapped: ToolDefinition = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      defaultConsent: "always",
      execute: async (args, ctx) => {
        const rawResult = await tool.execute(args, ctx);
        const remaining = Math.max(0, maxObservationChars - observedChars);
        const result = clampText(
          rawResult,
          Math.min(maxObservationCharsPerTool, remaining),
        );
        observedChars += result.length;
        const observation = { toolName: tool.name, args, result };
        observations.push(observation);
        options.onObservation?.(observation);
        return result;
      },
    };
    return adaptTool(wrapped, {
      contextFactory: ({ signal }) =>
        createInvocationContext(options.ctx, signal),
    });
  });

  const reportTool = createReportTool({
    schema: options.reportSchema,
    validate: options.validateReport,
    onAccepted: (report) => {
      acceptedReport = report;
    },
  });
  const allTools = [...readOnlyTools, reportTool];
  const settings = readSettings();
  const agent = await createDyadAgent({
    model: options.model ?? options.ctx.selectedModel ?? settings.selectedModel,
    settings,
    chatMode: "ask",
    systemPrompt: options.systemPrompt,
    tools: allTools,
    messages: [],
    dyadRequestId: options.ctx.dyadRequestId,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });
  agent.toolExecution = "sequential";

  agent.beforeToolCall = async ({ toolCall }) => {
    if (toolCall.name === "submit_report") return undefined;
    if (toolCalls >= maxToolCalls || observedChars >= maxObservationChars) {
      return {
        block: true,
        reason:
          "Read-only exploration budget exhausted. Call submit_report now.",
      };
    }
    toolCalls += 1;
    return undefined;
  };
  agent.afterToolCall = async ({ toolCall }) => {
    if (toolCall.name === "submit_report" && acceptedReport !== undefined) {
      return { terminate: true };
    }
    if (toolCalls >= maxToolCalls || turns >= maxTurns) {
      return { terminate: true };
    }
    return undefined;
  };
  agent.prepareNextTurnWithContext = ({ context }) => {
    if (
      turns >= maxTurns - 1 ||
      toolCalls >= maxToolCalls - 1 ||
      observedChars >= maxObservationChars
    ) {
      return { context: { ...context, tools: [reportTool] } };
    }
    return undefined;
  };
  agent.subscribe((event) => {
    if (event.type === "turn_start") turns += 1;
  });

  const abortFromParent = () => agent.abort();
  options.ctx.abortSignal?.addEventListener("abort", abortFromParent, {
    once: true,
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await agent.prompt(options.prompt);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timeout);
    options.ctx.abortSignal?.removeEventListener("abort", abortFromParent);
  }

  options.ctx.abortSignal?.throwIfAborted();
  if (acceptedReport !== undefined) {
    return {
      status: "submitted",
      report: acceptedReport,
      observations,
      turns,
      toolCalls,
    };
  }
  if (timedOut) {
    return { status: "timeout", observations, turns, toolCalls };
  }
  const errorMessage = agent.state.errorMessage;
  return {
    status: errorMessage ? "provider_error" : "no_report",
    observations,
    turns,
    toolCalls,
    ...(errorMessage ? { errorMessage } : {}),
  };
}
