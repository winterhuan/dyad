import { describe, expect, it } from "vitest";

import {
  localTemplatesData,
  NOVEL_TEMPLATE_ID,
  shouldCreateAppBlueprint,
} from "./templates";

describe("built-in templates", () => {
  it("registers the novel workspace as an official local template", () => {
    const novelTemplate = localTemplatesData.find(
      ({ id }) => id === NOVEL_TEMPLATE_ID,
    );

    expect(novelTemplate).toMatchObject({ isOfficial: true });
    expect(novelTemplate).not.toHaveProperty("githubUrl");
  });

  it("skips app blueprint generation only for the novel workspace", () => {
    expect(shouldCreateAppBlueprint(NOVEL_TEMPLATE_ID, true)).toBe(false);
    expect(shouldCreateAppBlueprint("react", true)).toBe(true);
    expect(shouldCreateAppBlueprint("react", false)).toBe(false);
  });
});
