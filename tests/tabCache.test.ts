import { describe, expect, it } from "vitest";
import {
  applyCachedLayout,
  cachedLayoutForTab,
  isCachedLayoutFresh,
  tabFromCachedMeta,
  toCachedTabMeta,
  type CachedTabLayout,
} from "../src/tabCache";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "tab-owned",
    name: "Owned Draft",
    authorId: "user-local",
    canEdit: true,
    clonedFromId: "tab-default",
    clonedFromName: "Now",
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
    ...overrides,
  };
}

describe("tab cache shaping", () => {
  it("stores D1-like metadata separately from layout payloads", () => {
    const tab = makeTab({ syncState: "dirty", dirtyAt: "2026-04-30T01:30:00.000Z", syncError: "offline" });
    const meta = toCachedTabMeta(tab);
    const layout = cachedLayoutForTab(tab);

    expect(meta).toMatchObject({
      id: "tab-owned",
      name: "Owned Draft",
      authorId: "user-local",
      canEdit: true,
      clonedFromId: "tab-default",
      clonedFromName: "Now",
      hasLayout: true,
      layoutUpdatedAt: "2026-04-30T01:00:00.000Z",
      syncState: "dirty",
      dirtyAt: "2026-04-30T01:30:00.000Z",
      syncError: "offline",
    });
    expect("layout" in meta).toBe(false);
    expect(layout).toEqual({
      id: "tab-owned",
      updatedAt: "2026-04-30T01:00:00.000Z",
      layout: tab.layout,
    });
  });

  it("rebuilds metadata as a summary tab until a fresh layout is applied", () => {
    const tab = makeTab();
    const summary = tabFromCachedMeta(toCachedTabMeta(tab));

    expect(summary.hasLayout).toBe(false);
    expect(summary.layout.tools).toEqual([]);

    expect(applyCachedLayout(summary, cachedLayoutForTab(tab))).toMatchObject({
      id: "tab-owned",
      hasLayout: true,
      layout: tab.layout,
    });
  });

  it("defaults older cache metadata to synced", () => {
    const summary = tabFromCachedMeta({
      id: "tab-old",
      name: "Old Cache",
      hasLayout: false,
      clonedFromId: null,
      clonedFromName: null,
    });

    expect(summary.syncState).toBe("synced");
  });

  it("rejects stale cached layouts by updatedAt", () => {
    const tab = makeTab({ updatedAt: "2026-04-30T02:00:00.000Z" });
    const staleLayout: CachedTabLayout = {
      id: tab.id,
      updatedAt: "2026-04-30T01:00:00.000Z",
      layout: tab.layout,
    };

    expect(isCachedLayoutFresh(tab, staleLayout)).toBe(false);
    expect(applyCachedLayout({ ...tab, hasLayout: false, layout: { unit: "in", tools: [] } }, staleLayout).hasLayout).toBe(false);
  });
});
