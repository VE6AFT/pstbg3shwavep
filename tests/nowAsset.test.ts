import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const svg = readFileSync(new URL("../src/assets/now.svg", import.meta.url), "utf8");

describe("blank Now floorplan asset contract", () => {
  it("keeps the saved layouts' original coordinate space and viewport", () => {
    const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
    expect(viewBox).toEqual([-400, -400, 2269.9179999999997, 1570.643]);
    expect(svg).toContain('transform="translate(-200 -200)"');
    expect(svg).not.toContain('matrix(1,0,0,1,400,400)');
    expect(svg).not.toContain('matrix(1,0,0,1,-192.602,-197.078)');
  });

  it("contains no baked-in tool layer or furniture labels", () => {
    expect(svg).not.toMatch(/\bid="(?:tools|layer-tools)"/);
    expect(svg).not.toMatch(/\bdata-tool-id=/);
    // The stairs' "Up" annotation belongs to the building, not a tool.
    const labels = Array.from(svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g), (match) => match[1]);
    expect(labels).toEqual(["Up"]);
  });

  it("preserves the mezzanine visibility hook", () => {
    expect(svg).toMatch(/<g\b[^>]*\bid="mezzanine"[^>]*\bdata-layer="mezzanine"/);
  });
});
