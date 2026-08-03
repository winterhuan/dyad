import { readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

import { test, Timeout } from "./helpers/test_helper";

test("create a novel writing workspace", async ({ po }, testInfo) => {
  testInfo.setTimeout(Timeout.EXTRA_LONG * 2);

  await po.setUp({ enableAppBlueprint: true });
  await po.navigation.goToTemplatesTab();
  await po.navigation.selectTemplate("Novel Writing Studio");
  await po.navigation.goToAppsTab();

  await po.sendPrompt("tc=local-agent/simple-response");

  const appPath = await po.appManagement.getCurrentAppPath();
  expect(
    readFileSync(path.join(appPath, "novel", "project.md"), "utf8"),
  ).toContain("# Untitled Novel");
  expect(
    readFileSync(
      path.join(appPath, "novel", "chapters", "001-opening.md"),
      "utf8",
    ),
  ).toContain("scene_id: 001-01");
  expect(
    readFileSync(
      path.join(appPath, ".agents", "skills", "novel-writing", "SKILL.md"),
      "utf8",
    ),
  ).toContain("name: novel-writing");
  await expect(po.page.getByTestId("messages-list")).toContainText(
    "This is a simple response from Agent mode.",
  );
});
