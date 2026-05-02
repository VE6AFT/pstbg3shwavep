import { VALIDATION_LIMITS } from "../functions/api/_shared";

export const TAB_SHARE_PARAM = "tab";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidSharedTabId(value: string | null | undefined) {
  return Boolean(
    value
      && value.length <= VALIDATION_LIMITS.tabIdChars
      && ID_PATTERN.test(value),
  );
}

export function readSharedTabId(search: string = typeof window === "undefined" ? "" : window.location.search) {
  try {
    const params = new URLSearchParams(search);
    const tabId = params.get(TAB_SHARE_PARAM);
    return isValidSharedTabId(tabId) ? tabId : null;
  } catch {
    return null;
  }
}

export function buildTabShareUrl(
  tabId: string,
  href: string = typeof window === "undefined" ? "https://example.test/" : window.location.href,
) {
  if (!isValidSharedTabId(tabId)) {
    throw new Error("Cannot build a share link for an invalid tab id");
  }

  const url = new URL(href);
  url.searchParams.set(TAB_SHARE_PARAM, tabId);
  return url.toString();
}
