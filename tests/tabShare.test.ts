import { describe, expect, it } from "vitest";
import { buildTabShareUrl, readSharedTabId } from "../src/tabShare";
import { VALIDATION_LIMITS } from "../functions/api/_shared";

describe("tab share links", () => {
  it("reads a valid tab parameter", () => {
    expect(readSharedTabId("?tab=tab-default")).toBe("tab-default");
    expect(readSharedTabId("?tab=tab_abc-123&mode=map")).toBe("tab_abc-123");
  });

  it("ignores invalid tab parameters", () => {
    expect(readSharedTabId("")).toBeNull();
    expect(readSharedTabId("?tab=")).toBeNull();
    expect(readSharedTabId("?tab=tab%20bad")).toBeNull();
    expect(readSharedTabId("?tab=tab.bad")).toBeNull();
    expect(readSharedTabId(`?tab=${"a".repeat(VALIDATION_LIMITS.tabIdChars + 1)}`)).toBeNull();
  });

  it("builds a share URL while preserving unrelated URL state", () => {
    expect(buildTabShareUrl("tab-new", "https://example.test/board?foo=1&tab=old#tools"))
      .toBe("https://example.test/board?foo=1&tab=tab-new#tools");
    expect(buildTabShareUrl("tab-new", "https://example.test/board?foo=1#tools"))
      .toBe("https://example.test/board?foo=1&tab=tab-new#tools");
  });

  it("rejects invalid tab ids when building share URLs", () => {
    expect(() => buildTabShareUrl("tab with spaces", "https://example.test/")).toThrow();
  });
});
