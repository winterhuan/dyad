import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("creates an app from a prompt and renders it in preview", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  await expect(
    po.page.getByRole("heading", { name: "What do you want to build?" }),
  ).toBeVisible();

  await po.sendPrompt("tc=local-agent/write-index", {
    timeout: Timeout.EXTRA_LONG,
  });

  const messages = po.page.getByTestId("messages-list");
  await expect(messages.getByText("tc=local-agent/write-index")).toBeVisible();
  await expect(
    messages.getByText("And it's done!", { exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: /^Version \d+$/ }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  await po.previewPanel.ensurePreviewPanelOpen();
  await po.previewPanel.expectPreviewIframeIsVisible(Timeout.EXTRA_LONG);
  await expect(
    po.previewPanel
      .getPreviewIframeElement()
      .contentFrame()
      .getByText("Testing:write-index!", { exact: true }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});
