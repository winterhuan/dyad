import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import type { VisualEditingChange } from "@/ipc/types";
import { VisualEditingChangesDialog } from "./VisualEditingChangesDialog";

const mocks = vi.hoisted(() => ({
  applyChanges: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    visualEditing: {
      applyChanges: mocks.applyChanges,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess,
}));

describe("VisualEditingChangesDialog", () => {
  beforeEach(() => {
    mocks.applyChanges.mockReset();
    mocks.showError.mockReset();
    mocks.showSuccess.mockReset();
  });

  it("applies pending changes once when the component rerenders during save", async () => {
    let resolveApplyChanges: (() => void) | undefined;
    mocks.applyChanges.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApplyChanges = () =>
            resolve({
              modifiedFiles: ["src/pages/Index.tsx"],
              commitHash: "commit-hash",
              appliedCount: 1,
              skipped: [],
            });
        }),
    );

    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([
        [
          "src/pages/Index.tsx:7",
          {
            componentId: "src/pages/Index.tsx:7",
            componentName: "h1",
            relativePath: "src/pages/Index.tsx",
            lineNumber: 7,
            styles: {
              margin: { left: "20px", right: "20px" },
            },
          },
        ],
      ]),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );

    const view = render(
      <VisualEditingChangesDialog onReset={() => undefined} />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mocks.applyChanges).toHaveBeenCalledTimes(1));

    view.rerender(<VisualEditingChangesDialog onReset={() => undefined} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.applyChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveApplyChanges?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    });
    expect(mocks.showSuccess).toHaveBeenCalledTimes(1);
  });

  it("retains skipped changes after saving the applicable components", async () => {
    mocks.applyChanges.mockResolvedValue({
      modifiedFiles: ["src/pages/Index.tsx"],
      commitHash: "commit-hash",
      appliedCount: 1,
      skipped: [
        {
          componentId: "src/pages/Index.tsx:12:2",
          reason: "Component location was not found in the source file.",
        },
      ],
    });
    const firstChange: VisualEditingChange = {
      componentId: "src/pages/Index.tsx:7:2",
      componentName: "h1",
      relativePath: "src/pages/Index.tsx",
      lineNumber: 7,
      columnNumber: 2,
      styles: { margin: { left: "20px" } },
    };
    const skippedChange: VisualEditingChange = {
      componentId: "src/pages/Index.tsx:12:2",
      componentName: "button",
      relativePath: "src/pages/Index.tsx",
      lineNumber: 12,
      columnNumber: 2,
      styles: { padding: { left: "8px" } },
    };
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([
        [firstChange.componentId, firstChange],
        [skippedChange.componentId, skippedChange],
      ]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const onReset = vi.fn();
    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    render(<VisualEditingChangesDialog onReset={onReset} />, {
      wrapper: Wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(store.get(pendingVisualChangesAtom)).toEqual(
        new Map([[skippedChange.componentId, skippedChange]]),
      );
    });
    expect(mocks.showSuccess).toHaveBeenCalledWith(
      "1 visual change saved; 1 skipped",
    );
    expect(onReset).not.toHaveBeenCalled();
  });

  it("retains changes added or updated while a save is in flight", async () => {
    let resolveApplyChanges: (() => void) | undefined;
    mocks.applyChanges.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApplyChanges = () =>
            resolve({
              modifiedFiles: ["src/pages/Index.tsx"],
              commitHash: "commit-hash",
              appliedCount: 1,
              skipped: [],
            });
        }),
    );
    const submittedChange: VisualEditingChange = {
      componentId: "src/pages/Index.tsx:7:2",
      componentName: "h1",
      relativePath: "src/pages/Index.tsx",
      lineNumber: 7,
      columnNumber: 2,
      styles: { margin: { left: "20px" } },
    };
    const updatedChange: VisualEditingChange = {
      ...submittedChange,
      styles: { margin: { left: "40px" } },
    };
    const newChange: VisualEditingChange = {
      componentId: "src/pages/Index.tsx:12:2",
      componentName: "p",
      relativePath: "src/pages/Index.tsx",
      lineNumber: 12,
      columnNumber: 2,
      styles: { padding: { left: "8px" } },
    };
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([[submittedChange.componentId, submittedChange]]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const onReset = vi.fn();
    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    render(<VisualEditingChangesDialog onReset={onReset} />, {
      wrapper: Wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.applyChanges).toHaveBeenCalledOnce());

    act(() => {
      store.set(pendingVisualChangesAtom, (current) => {
        const next = new Map(current);
        next.set(updatedChange.componentId, updatedChange);
        next.set(newChange.componentId, newChange);
        return next;
      });
    });
    await act(async () => {
      resolveApplyChanges?.();
    });

    await waitFor(() => {
      expect(store.get(pendingVisualChangesAtom)).toEqual(
        new Map([
          [updatedChange.componentId, updatedChange],
          [newChange.componentId, newChange],
        ]),
      );
    });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("discards pending changes for the selected app", () => {
    const change: VisualEditingChange = {
      componentId: "src/pages/Index.tsx:7:2",
      componentName: "h1",
      relativePath: "src/pages/Index.tsx",
      lineNumber: 7,
      columnNumber: 2,
      styles: { margin: { left: "20px" } },
    };
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(
      pendingVisualChangesAtom,
      new Map([[change.componentId, change]]),
    );
    const queryClient = new QueryClient();
    const onReset = vi.fn();
    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    render(<VisualEditingChangesDialog onReset={onReset} />, {
      wrapper: Wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(store.get(pendingVisualChangesAtom).size).toBe(0);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
