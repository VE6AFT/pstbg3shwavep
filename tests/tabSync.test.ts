import { describe, expect, it } from "vitest";
import { getDisketteStatus, isFlushableTab, mergeRemoteTabSummaries } from "../src/tabSync";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "owned",
    name: "Owned Draft",
    canEdit: true,
    hasLayout: true,
    layout: {
      unit: "in",
      tools: [
        {
          id: "tool-saw",
          name: "Table Saw",
          x: 10,
          y: 20,
          width: 96,
          height: 60,
          rotation: 0,
          color: "#db6b4d",
        },
      ],
    },
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T01:00:00.000Z",
    syncState: "synced",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return makeTab({
    hasLayout: false,
    layout: { unit: "in", tools: [] },
    ...overrides,
  });
}

describe("remote/local tab sync merge", () => {
  it("lets remote summaries replace stale synced cache", () => {
    const local = makeTab({ name: "Local Old", updatedAt: "2026-04-30T01:00:00.000Z" });
    const remote = makeSummary({ name: "Remote New", updatedAt: "2026-04-30T02:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [local])).toMatchObject([
      {
        id: "owned",
        name: "Remote New",
        hasLayout: false,
        syncState: "synced",
      },
    ]);
  });

  it("preserves local-only offline clones that are absent remotely", () => {
    const remote = makeSummary({ id: "now", name: "Now" });
    const localOnly = makeTab({
      id: "local",
      name: "Offline Clone",
      syncState: "local-only",
      dirtyAt: "2026-04-30T03:00:00.000Z",
    });

    expect(mergeRemoteTabSummaries([remote], [localOnly])).toEqual(expect.arrayContaining([localOnly]));
  });

  it("preserves draft clones without making them flushable", () => {
    const remote = makeSummary({ id: "now", name: "Now" });
    const draftClone = makeTab({
      id: "draft",
      name: "Renamed Local Draft",
      syncState: "draft-clone",
      dirtyAt: "2026-04-30T03:00:00.000Z",
    });

    expect(mergeRemoteTabSummaries([remote], [draftClone])).toEqual(expect.arrayContaining([draftClone]));
    expect(isFlushableTab(draftClone)).toBe(false);
  });

  it("keeps newer local dirty work over an older remote summary", () => {
    const local = makeTab({
      name: "Local New",
      syncState: "dirty",
      dirtyAt: "2026-04-30T03:00:00.000Z",
    });
    const remote = makeSummary({ name: "Remote Old", updatedAt: "2026-04-30T02:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [local])[0]).toMatchObject({
      name: "Local New",
      syncState: "dirty",
      layout: local.layout,
    });
  });

  it("preserves local dirty work even when a remote summary is newer", () => {
    const remote = makeSummary({ name: "Remote New", updatedAt: "2026-04-30T04:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [
      makeTab({ name: "Local Old", syncState: "dirty", dirtyAt: "2026-04-30T03:00:00.000Z" }),
    ])[0]).toMatchObject({ name: "Local Old", syncState: "dirty" });

    expect(mergeRemoteTabSummaries([remote], [
      makeTab({ name: "Local Undated", syncState: "dirty", dirtyAt: undefined }),
    ])[0]).toMatchObject({ name: "Local Undated", syncState: "dirty" });
  });

  it("adopts a remote base revision when a local-only tab appears remotely", () => {
    const localOnly = makeTab({
      id: "tab-local",
      name: "Offline Clone",
      syncState: "local-only",
      dirtyAt: "2026-04-30T03:00:00.000Z",
    });
    const remote = makeSummary({
      id: "tab-local",
      name: "Offline Clone",
      updatedAt: "2026-04-30T04:00:00.000Z",
    });

    expect(mergeRemoteTabSummaries([remote], [localOnly])[0]).toMatchObject({
      id: "tab-local",
      syncState: "dirty",
      updatedAt: "2026-04-30T04:00:00.000Z",
      layout: localOnly.layout,
    });
  });

  it("keeps newer delete-pending tabs queued and hidden from normal display", () => {
    const local = makeTab({
      syncState: "delete-pending",
      dirtyAt: "2026-04-30T05:00:00.000Z",
    });
    const remote = makeSummary({ updatedAt: "2026-04-30T04:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [local])[0]).toMatchObject({
      id: "owned",
      syncState: "delete-pending",
    });
  });
});

describe("diskette status", () => {
  it("keeps offline as a separate visual overlay from sync status", () => {
    expect(getDisketteStatus([makeTab({ syncState: "dirty" })], false, false)).toBe("dirty");
    expect(getDisketteStatus([makeTab()], false, false)).toBe("synced");
    expect(getDisketteStatus([makeTab({ syncState: "dirty" })], true, true)).toBe("saving");
    expect(getDisketteStatus([makeTab({ syncState: "dirty" })], true, false)).toBe("dirty");
    expect(getDisketteStatus([makeTab({ syncState: "draft-clone" })], true, false)).toBe("dirty");
    expect(getDisketteStatus([makeTab()], true, false)).toBe("synced");
  });

  it("does not flush dirty layouts that are only summaries", () => {
    expect(isFlushableTab(makeSummary({ syncState: "dirty", dirtyAt: "2026-04-30T03:00:00.000Z" }))).toBe(false);
    expect(isFlushableTab(makeSummary({ syncState: "local-only", dirtyAt: "2026-04-30T03:00:00.000Z" }))).toBe(false);
    expect(isFlushableTab(makeSummary({ syncState: "delete-pending", dirtyAt: "2026-04-30T03:00:00.000Z" }))).toBe(true);
  });
});
