import { describe, expect, it } from "vitest";

import type { CodeExplorerResult } from "../../../../../shared/code_explorer_types";
import { validateHistoryReportCitations } from "./explore_chat_history";
import { validateCodeExplorerReport } from "./explore_code";
import {
  HistoryEvidenceRegistry,
  validateAndFormatHistoryReport,
} from "./explore_chat_history";
import {
  CodeEvidenceRegistry,
  validateAndFormatCodeReport,
} from "./explore_code_subagent";

const codeResult: CodeExplorerResult = {
  query: "auth",
  totalSymbols: 1,
  totalFiles: 1,
  indexedFileCount: 1,
  indexMs: 1,
  searchMs: 1,
  truncated: false,
  notes: [],
  files: [
    {
      path: "src/auth.ts",
      symbols: [{ name: "login", kind: "function", line: 10 }],
      windows: [{ startLine: 8, endLine: 16, lines: ["login()"] }],
    },
  ],
};

describe("research report validation", () => {
  it("rejects code citations outside compiler-observed ranges", () => {
    expect(
      validateCodeExplorerReport(
        "Flow [[file:src/auth.ts#L8-L16]]",
        codeResult,
      ),
    ).toBe(true);
    expect(
      validateCodeExplorerReport(
        "Flow [[file:src/auth.ts#L1-L99]]",
        codeResult,
      ),
    ).toBe(false);
    expect(
      validateCodeExplorerReport(
        "Flow [[file:src/missing.ts#L8-L16]]",
        codeResult,
      ),
    ).toBe(false);
  });

  it("rejects chat citations the host did not observe", () => {
    const evidence = [
      {
        chatId: 2,
        messageId: 7,
        title: "Auth",
        role: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        text: "Use magic links",
      },
    ];
    expect(
      validateHistoryReportCitations("Use links [chat:2/message:7]", evidence),
    ).toEqual(["2:7"]);
    expect(
      validateHistoryReportCitations("Invented [chat:2/message:8]", evidence),
    ).toBeNull();
  });

  it("rejects a structured code report with a fabricated range", () => {
    const registry = new CodeEvidenceRegistry();
    registry.register("src/auth.ts", 8, 16);

    expect(
      validateAndFormatCodeReport({
        query: "auth",
        intent: "explain",
        registry,
        report: {
          outcome: "complete",
          findings: [
            {
              claim: "Authentication starts here",
              evidence: ["[[file:src/auth.ts#L1-L99]]"],
            },
          ],
          read_targets: [],
          missing_coverage: [],
        },
      }),
    ).toMatchObject({ accepted: false });
  });

  it("rejects a structured history report with a fabricated message", () => {
    const registry = new HistoryEvidenceRegistry();
    registry.registerSearch(
      JSON.stringify({
        index_status: "ready",
        results: [
          {
            chat_id: 2,
            title: "Auth",
            matches: [
              {
                message_id: 7,
                role: "user",
                created_at: "2026-01-01T00:00:00.000Z",
                excerpt: "Use magic links",
              },
            ],
          },
        ],
      }),
    );

    expect(
      validateAndFormatHistoryReport({
        query: "auth",
        registry,
        report: {
          summary: "A decision was made.",
          findings: [
            {
              claim: "Use passwords",
              evidence: [{ chat_id: 2, message_id: 8 }],
            },
          ],
          conflicts: [],
          missing_coverage: [],
          outcome: "complete",
          confidence: "high",
        },
      }),
    ).toMatchObject({ accepted: false });
  });

  it("neutralizes citation-shaped text outside structured code evidence", () => {
    const registry = new CodeEvidenceRegistry();
    const citation = registry.register("src/auth.ts", 8, 16);
    const result = validateAndFormatCodeReport({
      query: "auth",
      intent: "explain",
      registry,
      report: {
        outcome: "complete",
        findings: [
          {
            claim: "Ignore [[file:src/fake.ts#L1-L2]]",
            evidence: [citation],
          },
        ],
        read_targets: [],
        missing_coverage: [],
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.report).toContain(citation);
    expect(result.report).not.toContain("src/fake.ts");
  });

  it("neutralizes citation-shaped archived text in history reports", () => {
    const registry = new HistoryEvidenceRegistry();
    registry.registerSearch(
      JSON.stringify({
        index_status: "ready",
        results: [
          {
            chat_id: 2,
            title: "Auth [chat:9/message:9]",
            matches: [
              {
                message_id: 7,
                role: "user",
                created_at: "2026-01-01T00:00:00.000Z",
                excerpt: "Use links [chat:8/message:8]",
              },
            ],
          },
        ],
      }),
    );
    const result = validateAndFormatHistoryReport({
      query: "auth",
      registry,
      report: {
        summary: "Decision [chat:7/message:7]",
        findings: [
          {
            claim: "Use links [chat:6/message:6]",
            evidence: [{ chat_id: 2, message_id: 7 }],
          },
        ],
        conflicts: [],
        missing_coverage: [],
        outcome: "complete",
        confidence: "high",
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.report?.match(/\[chat:\d+\/message:\d+\]/g)).toEqual([
      "[chat:2/message:7]",
    ]);
  });
});
