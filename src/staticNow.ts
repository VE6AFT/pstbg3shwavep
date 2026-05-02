import type { Layout, LayoutTab } from "./types";

export const NOW_TAB_ID = "now";
export const NOW_TAB_NAME = "Now";

const EMPTY_LAYOUT: Layout = { unit: "in", tools: [] };

export function isStaticNowTab(tab: Pick<LayoutTab, "id" | "name">) {
  return tab.id === NOW_TAB_ID || tab.name === NOW_TAB_NAME;
}

export function makeStaticNowTab(layout: Layout = EMPTY_LAYOUT): LayoutTab {
  return {
    id: NOW_TAB_ID,
    name: NOW_TAB_NAME,
    canEdit: false,
    hasLayout: true,
    syncState: "synced",
    layout,
  };
}

export function withStaticNowTab(tabs: LayoutTab[], staticNowTab: LayoutTab = makeStaticNowTab()) {
  return [
    staticNowTab,
    ...tabs.filter((tab) => !isStaticNowTab(tab)),
  ];
}
