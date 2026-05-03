import { describe, expect, it } from "vitest";
import {
  applyCachedLayout,
  cachedLayoutForTab,
  isCachedLayoutFresh,
  shouldHydrateCachedTab,
  tabFromCachedMeta,
  toCachedTabMeta,
  type CachedTabLayout,
} from "../src/tabCache";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "owned",
    name: "Owned Draft",
    authorId: "user-local",
    canEdit: true,
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
    ...overrides,
  };
}

describe("tab cache shaping", () => {
  it("stores D1-like metadata separately from layout payloads", () => {
    const tab = makeTab({ syncState: "dirty", dirtyAt: "2026-04-30T01:30:00.000Z", syncError: "offline" });
    const meta = toCachedTabMeta(tab);
    const layout = cachedLayoutForTab(tab);

    expect(meta).toMatchObject({
      id: "owned",
      name: "Owned Draft",
      authorId: "user-local",
      canEdit: true,
      syncState: "dirty",
      dirtyAt: "2026-04-30T01:30:00.000Z",
      syncError: "offline",
    });
    expect("layout" in meta).toBe(false);
    expect(layout).toEqual({
      id: "owned",
      updatedAt: "2026-04-30T01:00:00.000Z",
      dirtyAt: "2026-04-30T01:30:00.000Z",
      layout: tab.layout,
    });
  });

  it("rebuilds metadata as a summary tab until a fresh layout is applied", () => {
    const tab = makeTab();
    const summary = tabFromCachedMeta(toCachedTabMeta(tab));

    expect(summary.hasLayout).toBe(false);
    expect(summary.layout.tools).toEqual([]);

    expect(applyCachedLayout(summary, cachedLayoutForTab(tab))).toMatchObject({
      id: "owned",
      hasLayout: true,
      layout: tab.layout,
    });
  });

  it("defaults cached metadata to synced", () => {
    const summary = tabFromCachedMeta({
      id: "cached",
      name: "Cached Tab",
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

  it("uses dirtyAt to validate unsynced cached layouts", () => {
    const dirtyTab = makeTab({
      syncState: "dirty",
      dirtyAt: "2026-04-30T03:00:00.000Z",
      updatedAt: "2026-04-30T01:00:00.000Z",
    });
    const freshDraftLayout: CachedTabLayout = {
      id: dirtyTab.id,
      updatedAt: "2026-04-30T01:00:00.000Z",
      dirtyAt: "2026-04-30T03:00:00.000Z",
      layout: dirtyTab.layout,
    };
    const staleDraftLayout: CachedTabLayout = {
      ...freshDraftLayout,
      dirtyAt: "2026-04-30T02:00:00.000Z",
    };

    expect(isCachedLayoutFresh(dirtyTab, freshDraftLayout)).toBe(true);
    expect(isCachedLayoutFresh(dirtyTab, staleDraftLayout)).toBe(false);
  });

  it("hydrates active and unsynced cached summaries", () => {
    expect(shouldHydrateCachedTab("tab-active", { id: "tab-active", syncState: "synced" })).toBe(true);
    expect(shouldHydrateCachedTab("tab-active", { id: "tab-dirty", syncState: "dirty" })).toBe(true);
    expect(shouldHydrateCachedTab("tab-active", { id: "tab-clean", syncState: "synced" })).toBe(false);
  });
});
