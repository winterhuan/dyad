import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  pendingVisualChangesAtom,
  setPendingVisualChangesForAppAtom,
} from "./previewAtoms";

describe("pendingVisualChangesAtom", () => {
  it("keeps unsaved visual changes isolated by app", () => {
    const store = createStore();
    const change = {
      componentId: "src/App.tsx:1:0",
      componentName: "div",
      relativePath: "src/App.tsx",
      lineNumber: 1,
      columnNumber: 0,
      styles: {},
    };

    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([[change.componentId, change]]),
    );
    store.set(selectedAppIdAtom, 2);
    expect(store.get(pendingVisualChangesAtom).size).toBe(0);

    store.set(selectedAppIdAtom, 1);
    expect(store.get(pendingVisualChangesAtom).get(change.componentId)).toEqual(
      change,
    );
  });

  it("updates the requested app without depending on the selected app", () => {
    const store = createStore();
    const originalChange = {
      componentId: "src/App.tsx:1:0",
      componentName: "div",
      relativePath: "src/App.tsx",
      lineNumber: 1,
      columnNumber: 0,
      styles: {},
    };
    const additionalChange = {
      ...originalChange,
      componentId: "src/App.tsx:2:0",
      lineNumber: 2,
    };

    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([[originalChange.componentId, originalChange]]),
    );
    store.set(selectedAppIdAtom, 2);
    store.set(setPendingVisualChangesForAppAtom, {
      appId: 1,
      changes: (current) =>
        new Map(current).set(additionalChange.componentId, additionalChange),
    });

    expect(store.get(pendingVisualChangesAtom).size).toBe(0);
    store.set(selectedAppIdAtom, 1);
    expect(store.get(pendingVisualChangesAtom)).toEqual(
      new Map([
        [originalChange.componentId, originalChange],
        [additionalChange.componentId, additionalChange],
      ]),
    );
  });
});
