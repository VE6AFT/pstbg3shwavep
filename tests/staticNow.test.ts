import { describe, expect, it } from "vitest";
import { isStaticNowTab, makeStaticNowTab, withStaticNowTab } from "../src/staticNow";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "owned",
    name: "Owned Draft",
    layout: { unit: "in", tools: [] },
    ...overrides,
  };
}

describe("static Now tab shaping", () => {
  it("always injects one immutable Now tab before user tabs", () => {
    const userTab = makeTab();

    expect(withStaticNowTab([userTab])).toMatchObject([
      {
        id: "now",
        name: "Now",
        canEdit: false,
        hasLayout: true,
        syncState: "synced",
      },
      {
        id: "owned",
        name: "Owned Draft",
      },
    ]);
  });

  it("recognizes the canonical id as static Now", () => {
    expect(isStaticNowTab(makeStaticNowTab())).toBe(true);
    expect(isStaticNowTab(makeTab({ name: "Now" }))).toBe(false);
    expect(isStaticNowTab(makeTab())).toBe(false);
  });
});
