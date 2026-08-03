// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import type { AgentContext, ToolDefinition } from "../tools/dyad/types";

const mocks = vi.hoisted(() => ({
  createDyadAgent: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("../agent_factory", () => ({
  createDyadAgent: mocks.createDyadAgent,
}));
vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

import { runReadOnlySubagent } from "./run_read_only_subagent";

const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
const reportSchema = z.object({ answer: z.string() });

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    referencedApps: new Map(),
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    todos: [],
    fileEditTracker: {},
    testRunAttempts: new Map(),
    toolConsents: {},
    dyadRequestId: "request-1",
    requireConsent: vi.fn(async () => true),
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
    ...overrides,
  } as unknown as AgentContext;
}

function readTool(
  execute: ToolDefinition<{ query: string }>["execute"] = async () =>
    "observed",
): ToolDefinition<{ query: string }> {
  return {
    name: "inspect",
    description: "Inspect read-only data",
    inputSchema: z.object({ query: z.string() }),
    defaultConsent: "always",
    execute,
  };
}

describe("runReadOnlySubagent", () => {
  beforeEach(() => {
    faux.setResponses([]);
    mocks.createDyadAgent.mockReset();
    mocks.readSettings.mockReset();
    mocks.readSettings.mockReturnValue({
      selectedModel: { provider: "faux", name: "faux-1" },
    });
    mocks.createDyadAgent.mockImplementation(async (params) => {
      const models = createModels();
      models.setProvider(faux.provider);
      return new Agent({
        streamFn: (model, agentContext, options) =>
          models.streamSimple(model, agentContext, options),
        initialState: {
          systemPrompt: params.systemPrompt,
          model: faux.getModel(),
          thinkingLevel: "off",
          tools: params.tools,
          messages: params.messages,
        },
      });
    });
  });

  it("runs only the whitelist with private callbacks and an empty transcript", async () => {
    let invocationContext: AgentContext | undefined;
    const parent = context({
      fileEditTracker: {
        "src/a.ts": { write_file: 1, search_replace: 0 },
      },
      mutationCount: 7,
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("inspect", { query: "auth" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        [fauxToolCall("submit_report", { answer: "done" })],
        { stopReason: "toolUse" },
      ),
    ]);

    const result = await runReadOnlySubagent({
      ctx: parent,
      systemPrompt: "read only",
      prompt: "inspect auth",
      tools: [
        readTool(async (_args, ctx) => {
          invocationContext = ctx;
          ctx.onXmlStream("hidden");
          ctx.onXmlComplete("hidden");
          return "observed auth";
        }),
      ],
      reportSchema,
      validateReport: (report) => ({
        accepted: true,
        feedback: "accepted",
        report: report.answer,
      }),
    });

    expect(result).toMatchObject({
      status: "submitted",
      report: "done",
      toolCalls: 1,
    });
    expect(mocks.createDyadAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [],
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "inspect" }),
          expect.objectContaining({ name: "submit_report" }),
        ]),
      }),
    );
    expect(parent.requireConsent).not.toHaveBeenCalled();
    expect(parent.onXmlStream).not.toHaveBeenCalled();
    expect(parent.onXmlComplete).not.toHaveBeenCalled();
    expect(invocationContext?.fileEditTracker).toEqual({});
    expect(invocationContext?.mutationCount).toBe(0);
    expect(parent.mutationCount).toBe(7);
  });

  it("rejects a state-modifying tool before creating the child agent", async () => {
    const mutatingTool: ToolDefinition<{ value: string }> = {
      name: "write_anything",
      description: "Write data",
      inputSchema: z.object({ value: z.string() }),
      defaultConsent: "always",
      modifiesState: true,
      execute: async () => "written",
    };

    await expect(
      runReadOnlySubagent({
        ctx: context(),
        systemPrompt: "read only",
        prompt: "write",
        tools: [mutatingTool],
        reportSchema,
        validateReport: () => ({ accepted: false, feedback: "no" }),
      }),
    ).rejects.toThrow("state-modifying tool");
    expect(mocks.createDyadAgent).not.toHaveBeenCalled();
  });

  it("enforces tool-call and observation budgets", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("inspect", { query: "large" })], {
        stopReason: "toolUse",
      }),
    ]);

    const result = await runReadOnlySubagent({
      ctx: context(),
      systemPrompt: "read only",
      prompt: "inspect",
      tools: [readTool(async () => "x".repeat(1_000))],
      reportSchema,
      validateReport: () => ({ accepted: false, feedback: "no" }),
      maxToolCalls: 1,
      maxObservationChars: 20,
      maxObservationCharsPerTool: 20,
    });

    expect(result.status).toBe("no_report");
    expect(result.toolCalls).toBe(1);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].result).toHaveLength(20);
  });

  it("aborts a blocking child tool at the timeout", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("inspect", { query: "wait" })], {
        stopReason: "toolUse",
      }),
    ]);
    const blocking = readTool(
      (_args, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.abortSignal?.addEventListener(
            "abort",
            () => reject(ctx.abortSignal?.reason),
            { once: true },
          );
        }),
    );

    const result = await runReadOnlySubagent({
      ctx: context(),
      systemPrompt: "read only",
      prompt: "wait",
      tools: [blocking],
      reportSchema,
      validateReport: () => ({ accepted: false, feedback: "no" }),
      timeoutMs: 10,
    });

    expect(result.status).toBe("timeout");
  });

  it("propagates cancellation from the parent turn", async () => {
    const abortController = new AbortController();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("inspect", { query: "wait" })], {
        stopReason: "toolUse",
      }),
    ]);
    const blocking = readTool(
      (_args, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.abortSignal?.addEventListener(
            "abort",
            () => reject(ctx.abortSignal?.reason),
            { once: true },
          );
        }),
    );

    const run = runReadOnlySubagent({
      ctx: context({ abortSignal: abortController.signal }),
      systemPrompt: "read only",
      prompt: "wait",
      tools: [blocking],
      reportSchema,
      validateReport: () => ({ accepted: false, feedback: "no" }),
    });
    setTimeout(() => abortController.abort("parent cancelled"), 10);

    await expect(run).rejects.toBe("parent cancelled");
  });

  it("reports provider failure so the caller can use its fallback", async () => {
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "provider failed",
      }),
    ]);

    const result = await runReadOnlySubagent({
      ctx: context(),
      systemPrompt: "read only",
      prompt: "inspect",
      tools: [readTool()],
      reportSchema,
      validateReport: () => ({ accepted: false, feedback: "no" }),
    });

    expect(result).toMatchObject({
      status: "provider_error",
      errorMessage: "provider failed",
    });
  });
});
