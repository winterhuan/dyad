import { describe, expect, it } from "vitest";

import { parseCodeSearchPaths, rankCodePathsLexically } from "./code_search";

describe("local code search", () => {
  it("accepts only exact paths from the host inventory", () => {
    const allowed = new Set(["src/auth/session.ts", "src/routes/login.tsx"]);
    expect(
      parseCodeSearchPaths(
        '{"paths":["src/routes/login.tsx","../../secret","src/routes/login.tsx"]}',
        allowed,
      ),
    ).toEqual(["src/routes/login.tsx"]);
  });

  it("falls back to deterministic path ranking", () => {
    expect(
      rankCodePathsLexically("authentication login", [
        "src/components/Button.tsx",
        "src/auth/login.ts",
        "src/auth/session.ts",
      ]),
    ).toEqual(["src/auth/login.ts"]);
  });
});
