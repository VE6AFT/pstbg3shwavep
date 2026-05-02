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
    id: "now",
    name: "Now",
    authorId: "user-local",
    layout: {
      unit: "in",
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

    expect(tab.id).toBe("now");
    expect(tab.name).toBe("Now");
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

  it("rejects too many tools", () => {
    const tools = Array.from({ length: VALIDATION_LIMITS.toolsPerTab + 1 }, (_, index) =>
      makeTool({ id: `tool-${index}` }),
    );

    expect(() => parseLayoutTabValue(makeTab({ layout: { unit: "in", tools } }))).toThrow(ValidationError);
  });

  it("limits tab names to the shared maximum length", () => {
    const maxName = "a".repeat(VALIDATION_LIMITS.tabNameChars);

    expect(parseLayoutTabValue(makeTab({ name: maxName })).name).toBe(maxName);
    expect(() => parseLayoutTabValue(makeTab({ name: `${maxName}a` }))).toThrow(ValidationError);
  });

  it("limits generated tab and tool ids to compact shared maximums", () => {
    const maxTabId = "t".repeat(VALIDATION_LIMITS.tabIdChars);
    const maxToolId = "x".repeat(VALIDATION_LIMITS.toolIdChars);

    expect(parseLayoutTabValue(makeTab({
      id: maxTabId,
      layout: {
        unit: "in",
        tools: [makeTool({ id: maxToolId })],
      },
    }))).toMatchObject({
      id: maxTabId,
      layout: {
        tools: [{ id: maxToolId }],
      },
    });

    expect(() => parseLayoutTabValue(makeTab({ id: `${maxTabId}a` }))).toThrow(ValidationError);
    expect(() => parseLayoutTabValue(makeTab({
      layout: {
        unit: "in",
        tools: [makeTool({ id: `${maxToolId}a` })],
      },
    }))).toThrow(ValidationError);
  });

  it("limits tool names and sizes to the shared maximums", () => {
    const maxToolName = "a".repeat(VALIDATION_LIMITS.toolNameChars);

    expect(parseLayoutTabValue(makeTab({
      layout: {
        unit: "in",
        tools: [makeTool({ name: maxToolName, width: VALIDATION_LIMITS.maxSize, height: VALIDATION_LIMITS.maxSize })],
      },
    })).layout.tools[0]).toMatchObject({
      name: maxToolName,
      width: VALIDATION_LIMITS.maxSize,
      height: VALIDATION_LIMITS.maxSize,
    });

    expect(() => parseLayoutTabValue(makeTab({
      layout: {
        unit: "in",
        tools: [makeTool({ name: `${maxToolName}a` })],
      },
    }))).toThrow(ValidationError);

    expect(() => parseLayoutTabValue(makeTab({
      layout: {
        unit: "in",
        tools: [makeTool({ width: VALIDATION_LIMITS.maxSize + 1 })],
      },
    }))).toThrow(ValidationError);
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
      id: "now",
    });

    await expect(parseLayoutTabRequest(requestWithJson({ tab: makeTab() }), { root: "tab" })).resolves.toMatchObject({
      id: "now",
    });
  });

  it("can expose editability without leaking author ids", () => {
    const tab = readLayoutTab({
      id: "owned",
      name: "Owned Draft",
      can_edit: 1,
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
