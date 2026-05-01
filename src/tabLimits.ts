import { TAB_LIMITS } from "../functions/api/_shared";
import { isStaticNowTab } from "./staticNow";
import type { LayoutTab } from "./types";

export function isClientAuthorTab(tab: LayoutTab, authorId: string) {
  return !isStaticNowTab(tab) && (tab.authorId === authorId || tab.canEdit === true);
}

export function countClientAuthorTabs(tabs: LayoutTab[], authorId: string) {
  return tabs.filter((tab) => isClientAuthorTab(tab, authorId)).length;
}

export function isClientAuthorTabLimitReached(tabs: LayoutTab[], authorId: string, limit = TAB_LIMITS.perAuthor) {
  return countClientAuthorTabs(tabs, authorId) >= limit;
}
