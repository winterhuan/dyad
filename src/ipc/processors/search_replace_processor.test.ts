import { describe, expect, it } from "vitest";

import { escapeSearchReplaceMarkers } from "@/shared/search_replace_markers";
import { applySearchReplace } from "./search_replace_processor";

function operation(search: string, replacement: string): string {
  return `<<<<<<< SEARCH\n${escapeSearchReplaceMarkers(search)}\n=======\n${escapeSearchReplaceMarkers(replacement)}\n>>>>>>> REPLACE`;
}

describe("applySearchReplace", () => {
  it("replaces one uniquely matching block", () => {
    const result = applySearchReplace(
      "first\nold line\nlast",
      operation("old line", "new line"),
    );

    expect(result).toEqual({
      success: true,
      content: "first\nnew line\nlast",
    });
  });

  it("rejects an ambiguous block without returning modified content", () => {
    const result = applySearchReplace(
      "same\nmiddle\nsame",
      operation("same", "changed"),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.error).toContain("ambiguous");
  });

  it("rejects a stale search block", () => {
    const result = applySearchReplace(
      "current content",
      operation("old content", "new content"),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("did not match");
  });

  it("matches indentation differences and anchors replacement indentation", () => {
    const result = applySearchReplace(
      "function run() {\n\treturn true;\n}",
      operation("  return true;", "  return false;"),
    );

    expect(result).toEqual({
      success: true,
      content: "function run() {\n\treturn false;\n}",
    });
  });

  it("preserves CRLF line endings", () => {
    const result = applySearchReplace(
      "first\r\nold\r\nlast",
      operation("old", "new"),
    );

    expect(result.content).toBe("first\r\nnew\r\nlast");
  });

  it("supports deleting a matched block", () => {
    const result = applySearchReplace(
      "first\nremove me\nlast",
      operation("remove me", ""),
    );

    expect(result.content).toBe("first\nlast");
  });

  it("treats conflict-marker-like lines as content", () => {
    const original = [
      "before",
      "<<<<<<< HEAD",
      "draft A",
      "=======",
      "draft B",
      ">>>>>>> branch",
      "after",
    ].join("\n");
    const search = [
      "<<<<<<< HEAD",
      "draft A",
      "=======",
      "draft B",
      ">>>>>>> branch",
    ].join("\n");

    const result = applySearchReplace(original, operation(search, "resolved"));

    expect(result).toEqual({
      success: true,
      content: "before\nresolved\nafter",
    });
  });
});
