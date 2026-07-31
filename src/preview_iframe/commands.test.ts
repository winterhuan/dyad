import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import {
  PREVIEW_IFRAME_MESSAGE_ROUTES,
  createPreviewIframeCommandAdapter,
  isTextEditingMessageForSelectedComponent,
  routePreviewIframeMessage,
} from "./commands";
import type { PreviewIframeEvent } from "./state";

describe("preview iframe command adapter", () => {
  it("accepts text events only for the currently selected component runtime", () => {
    const selectedComponent = {
      id: "src/App.tsx:7:2",
      runtimeId: "runtime-1",
    };

    expect(
      isTextEditingMessageForSelectedComponent(
        {
          componentId: selectedComponent.id,
          runtimeId: selectedComponent.runtimeId,
        },
        selectedComponent,
      ),
    ).toBe(true);
    expect(
      isTextEditingMessageForSelectedComponent(
        { componentId: selectedComponent.id },
        selectedComponent,
      ),
    ).toBe(true);
    expect(
      isTextEditingMessageForSelectedComponent(
        { componentId: selectedComponent.id, runtimeId: "stale-runtime" },
        selectedComponent,
      ),
    ).toBe(false);
    expect(
      isTextEditingMessageForSelectedComponent(
        {
          componentId: selectedComponent.id,
          runtimeId: selectedComponent.runtimeId,
        },
        null,
      ),
    ).toBe(false);
  });

  it("routes machine messages and leaves component routes claimable", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    routePreviewIframeMessage({
      event: {
        source: contentWindow,
        origin: "http://localhost:3000",
        data: { type: "pushState", payload: { newUrl: "/settings" } },
      } as unknown as MessageEvent,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(send).toHaveBeenCalledWith({
      type: "NAVIGATED_IN_APP",
      kind: "pushState",
      url: "http://localhost:3000/settings",
    });
    expect(onComponentMessage).not.toHaveBeenCalled();

    const selectorMessage = {
      source: contentWindow,
      origin: "http://localhost:3000",
      data: { type: "dyad-component-selector-initialized" },
    } as unknown as MessageEvent;
    routePreviewIframeMessage({
      event: selectorMessage,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(send).toHaveBeenCalledWith({ type: "SELECTOR_READY" });
    expect(onSharedMachineEvent).toHaveBeenCalledWith({
      type: "SELECTOR_READY",
    });
    expect(onComponentMessage).toHaveBeenCalledWith(selectorMessage);
    expect(PREVIEW_IFRAME_MESSAGE_ROUTES).toEqual({
      "dyad-component-selector-initialized": "shared-and-component",
      "dyad-screenshot-response": "shared-and-component",
      pushState: "machine",
      replaceState: "machine",
    });

    const responseMessage = {
      source: contentWindow,
      origin: "http://localhost:3000",
      data: {
        type: "dyad-screenshot-response",
        requestId: "capture:1",
        success: true,
        dataUrl: "data:image/png;base64,abc",
      },
    } as unknown as MessageEvent;
    routePreviewIframeMessage({
      event: responseMessage,
      contentWindow,
      appUrl: "http://localhost:3000",
      send,
      onSharedMachineEvent,
      onComponentMessage,
    });
    expect(onSharedMachineEvent).toHaveBeenLastCalledWith({
      type: "RESPONSE",
      requestId: "capture:1",
      ok: true,
      dataUrl: "data:image/png;base64,abc",
    });
    expect(onComponentMessage).toHaveBeenLastCalledWith(responseMessage);
  });

  it("rejects iframe navigation outside the trusted app origin", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    for (const newUrl of ["https://untrusted.example/path", "http://["]) {
      routePreviewIframeMessage({
        event: {
          source: contentWindow,
          origin: "http://localhost:3000",
          data: { type: "replaceState", payload: { newUrl } },
        } as unknown as MessageEvent,
        contentWindow,
        appUrl: "http://localhost:3000",
        send,
        onSharedMachineEvent,
        onComponentMessage,
      });
    }

    expect(send).not.toHaveBeenCalled();
    expect(onComponentMessage).not.toHaveBeenCalled();
  });

  it("rejects messages from a different source or origin", () => {
    const contentWindow = { postMessage: vi.fn() };
    const send = vi.fn<(event: PreviewIframeEvent) => void>();
    const onSharedMachineEvent = vi.fn();
    const onComponentMessage = vi.fn();

    for (const event of [
      {
        source: { postMessage: vi.fn() },
        origin: "http://localhost:3000",
        data: { type: "dyad-component-selector-initialized" },
      },
      {
        source: contentWindow,
        origin: "https://untrusted.example",
        data: { type: "dyad-component-selector-initialized" },
      },
    ]) {
      routePreviewIframeMessage({
        event: event as unknown as MessageEvent,
        contentWindow,
        appUrl: "http://localhost:3000",
        send,
        onSharedMachineEvent,
        onComponentMessage,
      });
    }

    expect(send).not.toHaveBeenCalled();
    expect(onSharedMachineEvent).not.toHaveBeenCalled();
    expect(onComponentMessage).not.toHaveBeenCalled();
  });

  it("posts navigation and restores the current selection exactly once", () => {
    const store = createStore();
    store.set(selectedComponentsPreviewAtom, [
      {
        id: "component-1",
        name: "Card",
        relativePath: "src/Card.tsx",
        lineNumber: 1,
        columnNumber: 1,
      },
    ]);
    const adapter = createPreviewIframeCommandAdapter(store);
    const target = { postMessage: vi.fn() };
    adapter.attach(7, () => target);
    const emit = vi.fn<(event: PreviewIframeEvent) => void>();

    adapter.execute(
      7,
      {
        type: "post-to-iframe",
        message: {
          type: "navigate",
          payload: { url: "http://localhost:3000/settings" },
        },
      },
      emit,
    );
    adapter.execute(
      7,
      { type: "post-to-iframe", message: { type: "restore-overlays" } },
      emit,
    );

    expect(target.postMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: "navigate",
        payload: { url: "http://localhost:3000/settings" },
      },
      "*",
    );
    expect(target.postMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: "restore-dyad-component-overlays",
        componentIds: ["component-1"],
      },
      "*",
    );
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ type: "SELECTION_RESTORED" });
  });
});
