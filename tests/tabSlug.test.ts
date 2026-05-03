import { describe, expect, it } from "vitest";
import { VALIDATION_LIMITS } from "../functions/api/_shared";
import {
  isTabSlugTail,
  makeTabSlugId,
  TAB_SLUG_ADJECTIVES,
  TAB_SLUG_NOUNS,
  TAB_SLUG_TAIL_LENGTH,
} from "../src/tabSlug";

function byteSequence(bytes: number[]) {
  let index = 0;
  return (length: number) => {
    const chunk = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      chunk[i] = bytes[index] ?? bytes.at(-1) ?? 0;
      index += 1;
    }
    return chunk;
  };
}

describe("tab slug generation", () => {
  it("emits prefixless adjective-noun-tail ids", () => {
    const id = makeTabSlugId([], { randomBytes: byteSequence([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
    const parts = id.split("-");

    expect(id).toBe(`${TAB_SLUG_ADJECTIVES[0]}-${TAB_SLUG_NOUNS[0]}-2222`);
    expect(parts).toHaveLength(3);
    expect(TAB_SLUG_ADJECTIVES).toContain(parts[0] as typeof TAB_SLUG_ADJECTIVES[number]);
    expect(TAB_SLUG_NOUNS).toContain(parts[1] as typeof TAB_SLUG_NOUNS[number]);
    expect(parts[2]).toHaveLength(TAB_SLUG_TAIL_LENGTH);
    expect(isTabSlugTail(parts[2])).toBe(true);
    expect(id.startsWith("tab-")).toBe(false);
  });

  it("fits shared tab id and visible name limits", () => {
    const id = makeTabSlugId([], { randomBytes: byteSequence([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]) });

    expect(id.length).toBeLessThanOrEqual(VALIDATION_LIMITS.tabIdChars);
    expect(id.length).toBeLessThanOrEqual(VALIDATION_LIMITS.tabNameChars);
    expect(/^[A-Za-z0-9_-]+$/.test(id)).toBe(true);
  });

  it("retries when a generated tab id already exists", () => {
    let calls = 0;
    const firstId = `${TAB_SLUG_ADJECTIVES[0]}-${TAB_SLUG_NOUNS[0]}-2222`;
    const randomBytes = (length: number) => {
      calls += 1;
      if (calls <= 3) return new Uint8Array(length).fill(0);
      return new Uint8Array(length).fill(1);
    };

    const id = makeTabSlugId([firstId], { randomBytes });

    expect(id).not.toBe(firstId);
    expect(id.endsWith("-3333")).toBe(true);
    expect(id.startsWith("tab-")).toBe(false);
  });
});
