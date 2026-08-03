// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  autoApproveChanges: false,
  agentToolConsents: {} as Record<string, "always" | "ask" | "never">,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => settings,
  writeSettings: () => {},
}));

import type { AgentContext } from "./types";
import {
  getAgentToolConsent,
  getAllAgentToolConsents,
  shouldIncludeTool,
  TOOL_DEFINITIONS,
} from "./tool_registry";

describe("agent tool consent defaults", () => {
  beforeEach(() => {
    settings.autoApproveChanges = false;
    settings.agentToolConsents = {};
  });

  it("uses auto-approve for tools without an explicit consent", () => {
    settings.autoApproveChanges = true;

    expect(getAgentToolConsent("write_file")).toBe("always");
    expect(getAllAgentToolConsents().write_file).toBe("always");
    expect(getAgentToolConsent("search_replace")).toBe("always");
    expect(getAllAgentToolConsents().search_replace).toBe("always");
  });

  it("keeps an explicit per-tool consent when auto-approve is enabled", () => {
    settings.autoApproveChanges = true;
    settings.agentToolConsents.write_file = "ask";

    expect(getAgentToolConsent("write_file")).toBe("ask");
    expect(getAllAgentToolConsents().write_file).toBe("ask");
  });

  it("requires consent for every bash invocation", () => {
    settings.autoApproveChanges = true;
    settings.agentToolConsents.bash = "always";

    expect(getAgentToolConsent("bash")).toBe("ask");
    expect(getAllAgentToolConsents().bash).toBe("ask");

    settings.agentToolConsents.bash = "never";
    expect(getAgentToolConsent("bash")).toBe("never");
  });

  it("filters tools using the accepted turn's consent snapshot", () => {
    settings.agentToolConsents.write_file = "always";
    const writeFile = TOOL_DEFINITIONS.find(
      (tool) => tool.name === "write_file",
    );

    expect(writeFile).toBeDefined();
    expect(
      shouldIncludeTool(writeFile!, {
        toolConsents: { write_file: "never" },
      } as unknown as AgentContext),
    ).toBe(false);
  });

  it("registers migrated read-only research and sandbox tools", () => {
    for (const name of [
      "explore_code",
      "explore_chat_history",
      "execute_sandbox_script",
      "web_crawl",
      "code_search",
    ]) {
      const tool = TOOL_DEFINITIONS.find(
        (candidate) => candidate.name === name,
      );
      expect(tool, name).toBeDefined();
      expect(tool?.modifiesState).not.toBe(true);
    }
  });
});
