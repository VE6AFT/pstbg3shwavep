import { describe, expect, it } from "vitest";
import { TAB_LIMITS } from "../functions/api/_shared";
import { countClientAuthorTabs, isClientAuthorTabLimitReached } from "../src/tabLimits";
import type { LayoutTab } from "../src/types";

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "owned",
    name: "Owned Draft",
    layout: { unit: "in", tools: [] },
    ...overrides,
  };
}

describe("client author tab limits", () => {
  it("counts remote editable tabs and local authored tabs", () => {
    const tabs = [
      makeTab({ id: "now", name: "Now", canEdit: false }),
      makeTab({ id: "remote-owned", canEdit: true }),
      makeTab({ id: "local-only", authorId: "user-local" }),
      makeTab({ id: "someone-else", authorId: "user-other", canEdit: false }),
    ];

    expect(countClientAuthorTabs(tabs, "user-local")).toBe(2);
  });

  it("treats the twentieth authored tab as the clone limit", () => {
    const tabs = Array.from({ length: TAB_LIMITS.perAuthor }, (_, index) =>
      makeTab({ id: `sheet-${index}`, canEdit: true }),
    );

    expect(isClientAuthorTabLimitReached(tabs, "user-local")).toBe(true);
    expect(isClientAuthorTabLimitReached(tabs.slice(1), "user-local")).toBe(false);
  });
});
