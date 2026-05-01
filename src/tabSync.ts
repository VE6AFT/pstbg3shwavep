import type { LayoutTab } from "./types";

export type DisketteStatus = "offline" | "saving" | "dirty" | "synced";

const FLUSHABLE_SYNC_STATES = new Set<LayoutTab["syncState"]>(["dirty", "local-only", "delete-pending"]);
const UNSYNCED_SYNC_STATES = new Set<LayoutTab["syncState"]>(["dirty", "local-only", "saving", "error", "delete-pending"]);

export function stripSyncMetadata(tab: LayoutTab): LayoutTab {
  const { syncState: _syncState, dirtyAt: _dirtyAt, syncError: _syncError, ...serverTab } = tab;
  return serverTab;
}

export function withSyncedState(tab: LayoutTab): LayoutTab {
  return {
    ...tab,
    syncState: "synced",
    dirtyAt: undefined,
    syncError: undefined,
  };
}

export function isFlushableTab(tab: LayoutTab) {
  return FLUSHABLE_SYNC_STATES.has(tab.syncState);
}

export function hasFlushableTabs(tabs: LayoutTab[]) {
  return tabs.some(isFlushableTab);
}

export function isUnsyncedTab(tab: LayoutTab) {
  return UNSYNCED_SYNC_STATES.has(tab.syncState);
}

export function isHiddenPendingDelete(tab: LayoutTab) {
  return tab.syncState === "delete-pending";
}

export function visibleTabs(tabs: LayoutTab[]) {
  return tabs.filter((tab) => !isHiddenPendingDelete(tab));
}

export function mergeRemoteTabSummaries(remoteTabs: LayoutTab[], currentTabs: LayoutTab[]) {
  const currentById = new Map(currentTabs.map((tab) => [tab.id, tab]));
  const remoteIds = new Set(remoteTabs.map((tab) => tab.id));
  const merged = remoteTabs.map((remote) => {
    const current = currentById.get(remote.id);

    if (current && shouldLocalVersionWin(current, remote)) {
      return {
        ...current,
        syncState: current.syncState === "local-only" ? "dirty" : current.syncState,
      };
    }

    if (current && current.hasLayout !== false && current.updatedAt === remote.updatedAt) {
      return withSyncedState({
        ...remote,
        layout: current.layout,
        hasLayout: true,
      });
    }

    return withSyncedState(remote);
  });

  currentTabs.forEach((current) => {
    if (remoteIds.has(current.id)) return;
    if (shouldPreserveLocalOnlyVersion(current)) {
      merged.push(current);
    }
  });

  return merged;
}

export function getDisketteStatus(tabs: LayoutTab[], dbReachable: boolean, syncInFlight: boolean): DisketteStatus {
  if (!dbReachable) return "offline";
  if (syncInFlight || tabs.some((tab) => tab.syncState === "saving")) return "saving";
  if (tabs.some(isUnsyncedTab)) return "dirty";
  return "synced";
}

export function disketteStatusLabel(status: DisketteStatus) {
  switch (status) {
    case "offline":
      return "Database offline; changes are local";
    case "saving":
      return "Saving changes to database";
    case "dirty":
      return "Local changes waiting to sync";
    case "synced":
      return "All changes synced to database";
  }
}

function shouldPreserveLocalOnlyVersion(tab: LayoutTab) {
  return tab.syncState === "dirty"
    || tab.syncState === "local-only"
    || tab.syncState === "saving"
    || tab.syncState === "error"
    || tab.syncState === "delete-pending";
}

function shouldLocalVersionWin(local: LayoutTab, remote: LayoutTab) {
  if (!shouldPreserveLocalOnlyVersion(local)) return false;
  const localTime = parseDateTime(local.dirtyAt);
  const remoteTime = parseDateTime(remote.updatedAt);
  if (localTime === null || remoteTime === null) return false;
  return localTime > remoteTime;
}

function parseDateTime(value: string | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
