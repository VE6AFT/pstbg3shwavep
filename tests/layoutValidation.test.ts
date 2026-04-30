import { describe, expect, it } from "vitest";
import {
  parseLayoutTabRequest,
  parseLayoutTabValue,
  readAuthorIdHeader,
  readLayoutTab,
  VALIDATION_LIMITS,
  ValidationError,
  type TabRow,
  type LayoutTab,
  type ToolShape,
} from "../functions/api/_shared";

function makeTool(overrides: Partial<ToolShape> = {}): ToolShape {
  return {
    id: "tool-saw",
    assetId: "asset-table-saw",
    name: "Table Saw",
    x: 10,
    y: 20,
    width: 96,
    height: 60,
    rotation: 0,
    color: "#db6b4d",
    scope: "wood",
    hazards: ["dust", "noise"],
    ...overrides,
  };
}

function makeTab(overrides: Partial<LayoutTab> = {}): LayoutTab {
  return {
    id: "tab-default",
    name: "Baseline Layout",
    authorId: "user-local",
    clonedFromId: null,
    clonedFromName: null,
    baseSvgMarkup: null,
    layout: {
      unit: "in",
      bays: [
        { id: "bay-105", label: "105", x: 0, y: 0, width: 444, height: 1188 },
      ],
      tools: [makeTool()],
    },
    ...overrides,
  };
}

function requestWithJson(value: unknown) {
  return new Request("https://example.test/api/tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("layout tab validation", () => {
  it("accepts a normal tab and returns canonical data", () => {
    const tab = parseLayoutTabValue(makeTab());

    expect(tab.id).toBe("tab-default");
    expect(tab.name).toBe("Baseline Layout");
    expect(tab.layout.unit).toBe("in");
    expect(tab.layout.tools[0].scope).toBe("wood");
    expect(tab.layout.tools[0].hazards).toEqual(["dust", "noise"]);
  });

  it("strips unknown fields before returning canonical data", () => {
    const tab = parseLayoutTabValue({
      ...makeTab(),
      debugOnly: "drop me",
      layout: {
        ...makeTab().layout,
        surprise: true,
        tools: [{ ...makeTool(), privateNote: "drop me too" }],
      },
    });

    expect("debugOnly" in tab).toBe(false);
    expect("surprise" in tab.layout).toBe(false);
    expect("privateNote" in tab.layout.tools[0]).toBe(false);
  });

  it("rejects too many tools or bays", () => {
    const tools = Array.from({ length: VALIDATION_LIMITS.toolsPerTab + 1 }, (_, index) =>
      makeTool({ id: `tool-${index}` }),
    );
    const bays = Array.from({ length: VALIDATION_LIMITS.baysPerTab + 1 }, (_, index) => ({
      id: `bay-${index}`,
      label: `${index}`,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }));

    expect(() => parseLayoutTabValue(makeTab({ layout: { unit: "in", bays, tools } }))).toThrow(ValidationError);
  });

  it("rejects oversized JSON before parsing", async () => {
    const request = new Request("https://example.test/api/tabs", {
      method: "POST",
      body: " ".repeat(VALIDATION_LIMITS.requestBytes + 1),
    });

    await expect(parseLayoutTabRequest(request)).rejects.toMatchObject({
      details: [`request body must be at most ${VALIDATION_LIMITS.requestBytes} bytes`],
    });
  });

  it("rejects invalid ids, names, numbers, colors, scopes, and hazards", () => {
    expect(() =>
      parseLayoutTabValue(
        makeTab({
          id: "tab with spaces",
          name: "",
          layout: {
            unit: "in",
            bays: [{ id: "bay-1", label: "105", x: Number.NaN, y: 0, width: 10, height: 10 }],
            tools: [
              makeTool({
                color: "tomato",
                rotation: Infinity,
                scope: "not-a-scope" as ToolShape["scope"],
                hazards: ["dust", "dust", "lava" as NonNullable<ToolShape["hazards"]>[number]],
              }),
            ],
          },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it("supports both direct save and nested clone request shapes", async () => {
    await expect(parseLayoutTabRequest(requestWithJson(makeTab()))).resolves.toMatchObject({
      id: "tab-default",
    });

    await expect(parseLayoutTabRequest(requestWithJson({ tab: makeTab() }), { root: "tab" })).resolves.toMatchObject({
      id: "tab-default",
    });
  });

  it("can expose editability without leaking author ids", () => {
    const tab = readLayoutTab({
      id: "tab-owned",
      name: "Owned Draft",
      can_edit: 1,
      cloned_from_tab_id: null,
      cloned_from_tab_name: null,
      layout_json: JSON.stringify(makeTab().layout),
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z",
    } satisfies TabRow);

    expect(tab.canEdit).toBe(true);
    expect("authorId" in tab).toBe(false);
  });

  it("accepts only valid anonymous author headers", () => {
    expect(readAuthorIdHeader(new Request("https://example.test", {
      headers: { "X-Author-Id": "user-local_123" },
    }))).toBe("user-local_123");
    expect(readAuthorIdHeader(new Request("https://example.test", {
      headers: { "X-Author-Id": "user with spaces" },
    }))).toBeNull();
  });
});
