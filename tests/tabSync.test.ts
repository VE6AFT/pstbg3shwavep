import { describe, expect, it } from "vitest";
import { getDisketteStatus, mergeRemoteTabSummaries } from "../src/tabSync";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "tab-owned",
    name: "Owned Draft",
    canEdit: true,
    clonedFromId: "tab-default",
    clonedFromName: "Now",
    hasLayout: true,
    layout: {
      unit: "in",
      tools: [
        {
          id: "tool-saw",
          assetId: "asset-table-saw",
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
        id: "tab-owned",
        name: "Remote New",
        hasLayout: false,
        syncState: "synced",
      },
    ]);
  });

  it("preserves local-only offline clones that are absent remotely", () => {
    const remote = makeSummary({ id: "tab-default", name: "Now" });
    const localOnly = makeTab({
      id: "tab-local",
      name: "Offline Clone",
      syncState: "local-only",
      dirtyAt: "2026-04-30T03:00:00.000Z",
    });

    expect(mergeRemoteTabSummaries([remote], [localOnly])).toEqual(expect.arrayContaining([localOnly]));
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

  it("lets newer remote summaries win over older or undated local dirty work", () => {
    const remote = makeSummary({ name: "Remote New", updatedAt: "2026-04-30T04:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [
      makeTab({ name: "Local Old", syncState: "dirty", dirtyAt: "2026-04-30T03:00:00.000Z" }),
    ])[0]).toMatchObject({ name: "Remote New", syncState: "synced" });

    expect(mergeRemoteTabSummaries([remote], [
      makeTab({ name: "Local Undated", syncState: "dirty", dirtyAt: undefined }),
    ])[0]).toMatchObject({ name: "Remote New", syncState: "synced" });
  });

  it("keeps newer delete-pending tabs queued and hidden from normal display", () => {
    const local = makeTab({
      syncState: "delete-pending",
      dirtyAt: "2026-04-30T05:00:00.000Z",
    });
    const remote = makeSummary({ updatedAt: "2026-04-30T04:00:00.000Z" });

    expect(mergeRemoteTabSummaries([remote], [local])[0]).toMatchObject({
      id: "tab-owned",
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
    expect(getDisketteStatus([makeTab()], true, false)).toBe("synced");
  });
});
