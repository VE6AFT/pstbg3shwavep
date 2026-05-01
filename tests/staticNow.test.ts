import { describe, expect, it } from "vitest";
import { isStaticNowTab, makeStaticNowTab, withStaticNowTab } from "../src/staticNow";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "tab-owned",
    name: "Owned Draft",
    layout: { unit: "in", tools: [] },
    ...overrides,
  };
}

describe("static Now tab shaping", () => {
  it("always injects one immutable Now tab before user tabs", () => {
    const userTab = makeTab();
    const staleNow = makeTab({ id: "old-cache-now", name: "Now", canEdit: true });

    expect(withStaticNowTab([userTab, staleNow])).toMatchObject([
      {
        id: "tab-default",
        name: "Now",
        canEdit: false,
        hasLayout: true,
        syncState: "synced",
      },
      {
        id: "tab-owned",
        name: "Owned Draft",
      },
    ]);
  });

  it("recognizes the canonical id and legacy name as static Now", () => {
    expect(isStaticNowTab(makeStaticNowTab())).toBe(true);
    expect(isStaticNowTab(makeTab({ name: "Now" }))).toBe(true);
    expect(isStaticNowTab(makeTab())).toBe(false);
  });
});
