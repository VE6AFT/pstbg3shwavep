import { describe, expect, it } from "vitest";
import { buildTabShareUrl, readSharedTabId, urlWithoutSharedTab } from "../src/tabShare";
import { VALIDATION_LIMITS } from "../functions/api/_shared";

describe("tab share links", () => {
  it("reads a valid share parameter", () => {
    expect(readSharedTabId("?share=now")).toBe("now");
    expect(readSharedTabId("?share=quiet-rivet-k7m2&mode=map")).toBe("quiet-rivet-k7m2");
  });

  it("ignores invalid share parameters", () => {
    expect(readSharedTabId("")).toBeNull();
    expect(readSharedTabId("?tab=now")).toBeNull();
    expect(readSharedTabId("?share=")).toBeNull();
    expect(readSharedTabId("?share=quiet%20rivet")).toBeNull();
    expect(readSharedTabId("?share=quiet.rivet")).toBeNull();
    expect(readSharedTabId(`?share=${"a".repeat(VALIDATION_LIMITS.tabIdChars + 1)}`)).toBeNull();
  });

  it("builds a share URL while preserving unrelated URL state", () => {
    expect(buildTabShareUrl("quiet-rivet-k7m2", "https://example.test/board?foo=1&share=old#tools"))
      .toBe("https://example.test/board?foo=1&share=quiet-rivet-k7m2#tools");
    expect(buildTabShareUrl("quiet-rivet-k7m2", "https://example.test/board?foo=1#tools"))
      .toBe("https://example.test/board?foo=1&share=quiet-rivet-k7m2#tools");
  });

  it("removes only the share parameter from a URL", () => {
    expect(urlWithoutSharedTab("https://example.test/board?foo=1&share=quiet-rivet-k7m2&mode=map#tools"))
      .toBe("https://example.test/board?foo=1&mode=map#tools");
    expect(urlWithoutSharedTab("https://example.test/board?share=quiet-rivet-k7m2#tools"))
      .toBe("https://example.test/board#tools");
    expect(urlWithoutSharedTab("https://example.test/board?tab=old&share=quiet-rivet-k7m2#tools"))
      .toBe("https://example.test/board?tab=old#tools");
  });

  it("rejects invalid tab ids when building share URLs", () => {
    expect(() => buildTabShareUrl("quiet rivet", "https://example.test/")).toThrow();
  });
});
