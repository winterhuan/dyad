import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodeExplorerIndex,
  exploreCode,
} from "../../../workers/code_explorer/core";

const tempDirs: string[] = [];

describe("Code Explorer", () => {
  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns cross-file symbols and line-numbered source windows", () => {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-explorer-"));
    tempDirs.push(appPath);
    fs.mkdirSync(path.join(appPath, "src", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    fs.writeFileSync(
      path.join(appPath, "src/auth/session.ts"),
      [
        "export interface Session {",
        "  token: string;",
        "}",
        "",
        "export function createSession(userId: string): Session {",
        "  return { token: `session:${userId}` };",
        "}",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(appPath, "src/auth/AuthService.ts"),
      [
        "import { createSession } from './session';",
        "",
        "export class AuthService {",
        "  login(userId: string) {",
        "    return createSession(userId);",
        "  }",
        "}",
      ].join("\n"),
    );

    const result = exploreCode(ts, {
      appPath,
      query: "login session auth service flow",
      maxFiles: 4,
      maxDepth: 2,
    });

    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "src/auth/AuthService.ts",
        "src/auth/session.ts",
      ]),
    );
    expect(result.totalSymbols).toBeGreaterThan(0);
    expect(
      result.files.some((file) =>
        file.windows.some((window) =>
          window.lines.some((line) => line.includes("login(userId")),
        ),
      ),
    ).toBe(true);
  });

  it("excludes declaration files from the symbol index", () => {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-explorer-"));
    tempDirs.push(appPath);
    fs.mkdirSync(path.join(appPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext" },
        include: ["src/**/*"],
      }),
    );
    fs.writeFileSync(
      path.join(appPath, "src/runtime.mts"),
      "export function runtimeBadge() { return 'runtime'; }\n",
    );
    fs.writeFileSync(
      path.join(appPath, "src/types.d.ts"),
      "export declare function declaredBadge(): string;\n",
    );

    const built = buildCodeExplorerIndex(ts, { appPath });
    const paths = [...built.index.byFile.keys()];
    expect(paths).toContain("src/runtime.mts");
    expect(paths).not.toContain("src/types.d.ts");
  });
});
