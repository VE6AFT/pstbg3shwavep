import { describe, expect, it } from "vitest";
import { buildTabShareUrl, readSharedTabId, urlWithoutSharedTab } from "../src/tabShare";
import { VALIDATION_LIMITS } from "../functions/api/_shared";

describe("tab share links", () => {
  it("reads a valid share parameter", () => {
    expect(readSharedTabId("?share=tab-default")).toBe("tab-default");
    expect(readSharedTabId("?share=tab_abc-123&mode=map")).toBe("tab_abc-123");
  });

  it("ignores invalid share parameters", () => {
    expect(readSharedTabId("")).toBeNull();
    expect(readSharedTabId("?tab=tab-default")).toBeNull();
    expect(readSharedTabId("?share=")).toBeNull();
    expect(readSharedTabId("?share=tab%20bad")).toBeNull();
    expect(readSharedTabId("?share=tab.bad")).toBeNull();
    expect(readSharedTabId(`?share=${"a".repeat(VALIDATION_LIMITS.tabIdChars + 1)}`)).toBeNull();
  });

  it("builds a share URL while preserving unrelated URL state", () => {
    expect(buildTabShareUrl("tab-new", "https://example.test/board?foo=1&share=old#tools"))
      .toBe("https://example.test/board?foo=1&share=tab-new#tools");
    expect(buildTabShareUrl("tab-new", "https://example.test/board?foo=1#tools"))
      .toBe("https://example.test/board?foo=1&share=tab-new#tools");
  });

  it("removes only the share parameter from a URL", () => {
    expect(urlWithoutSharedTab("https://example.test/board?foo=1&share=tab-new&mode=map#tools"))
      .toBe("https://example.test/board?foo=1&mode=map#tools");
    expect(urlWithoutSharedTab("https://example.test/board?share=tab-new#tools"))
      .toBe("https://example.test/board#tools");
    expect(urlWithoutSharedTab("https://example.test/board?tab=old&share=tab-new#tools"))
      .toBe("https://example.test/board?tab=old#tools");
  });

  it("rejects invalid tab ids when building share URLs", () => {
    expect(() => buildTabShareUrl("tab with spaces", "https://example.test/")).toThrow();
  });
});
