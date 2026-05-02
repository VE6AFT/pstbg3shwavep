import { describe, expect, it } from "vitest";
import { VALIDATION_LIMITS } from "../functions/api/_shared";
import { makeShortId, SHORT_ID_ALPHABET, SHORT_ID_LENGTH } from "../src/shortId";

function repeatedByte(byte: number) {
  return (length: number) => new Uint8Array(length).fill(byte);
}

describe("short id generation", () => {
  it("preserves the prefix and emits a fixed-length suffix", () => {
    const id = makeShortId("tool", [], { randomBytes: repeatedByte(0) });

    expect(id).toBe(`tool-${SHORT_ID_ALPHABET[0].repeat(SHORT_ID_LENGTH)}`);
    expect(id.slice("tool-".length)).toHaveLength(SHORT_ID_LENGTH);
  });

  it("emits ids accepted by shared validation limits", () => {
    const toolId = makeShortId("tool", [], { randomBytes: repeatedByte(2) });
    const idPattern = /^[A-Za-z0-9_-]+$/;

    expect(toolId).toHaveLength("tool-".length + SHORT_ID_LENGTH);
    expect(toolId.length).toBeLessThanOrEqual(VALIDATION_LIMITS.toolIdChars);
    expect(idPattern.test(toolId)).toBe(true);
  });

  it("retries when a generated id already exists", () => {
    let calls = 0;
    const randomBytes = (length: number) => {
      calls += 1;
      return new Uint8Array(length).fill(calls === 1 ? 0 : 1);
    };
    const collision = `tool-${SHORT_ID_ALPHABET[0].repeat(SHORT_ID_LENGTH)}`;

    expect(makeShortId("tool", [collision], { randomBytes }))
      .toBe(`tool-${SHORT_ID_ALPHABET[1].repeat(SHORT_ID_LENGTH)}`);
  });
});
