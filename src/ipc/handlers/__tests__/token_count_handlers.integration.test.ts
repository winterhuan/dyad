// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return {
    ipcHandlers: new Map(),
    models: { current: null as any },
  };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("@/ipc/pi/model_runtime", () => ({
  getPiModels: () => h.models.current,
  resolveDyadModel: (model: { provider: string; name: string }) =>
    h.models.current.getModel(model.provider, model.name),
}));

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerTokenCountHandlers } from "@/ipc/handlers/token_count_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";

function makeEvent() {
  const frame = { url: "http://localhost:5173/" };
  return {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
    senderFrame: frame,
  };
}

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("token counting excludes skills for security review (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableAppBlueprint: false,
        agentToolConsents: {},
      },
    });
    registerTokenCountHandlers();
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("counts the catalog for normal input but not for /security-review input", async () => {
    const prompt = "estimate my context usage";
    const count = (input: string) =>
      invoke("chat:count-tokens", { chatId: harness.chatId, input });

    const baseNormal = (await count(prompt)).estimatedTotalTokens as number;
    const baseReview = (await count("/security-review " + prompt))
      .estimatedTotalTokens as number;
    const summaryPrompt = "Summarize from chat-id=123";
    const baseSummary = (await count(summaryPrompt)).estimatedTotalTokens;

    const skillDir = path.join(
      harness.appDir,
      ".agents",
      "skills",
      "pdf-processing",
    );
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: pdf-processing
description: Extract text and tables from PDF files.
---

# PDF Processing
`,
    );

    try {
      const withSkillNormal = (await count(prompt))
        .estimatedTotalTokens as number;
      const withSkillReview = (await count("/security-review " + prompt))
        .estimatedTotalTokens as number;
      const withSkillSummary = (await count(summaryPrompt))
        .estimatedTotalTokens;

      // The catalog is included for normal turns...
      expect(withSkillNormal).toBeGreaterThan(baseNormal);
      // ...but excluded for security review, matching the real prompt path.
      expect(withSkillReview).toBe(baseReview);
      // Summary turns replace the assembled system prompt as well.
      expect(withSkillSummary).toBe(baseSummary);
    } finally {
      await fs.promises.rm(path.join(harness.appDir, ".agents"), {
        recursive: true,
        force: true,
      });
    }
  });
});
