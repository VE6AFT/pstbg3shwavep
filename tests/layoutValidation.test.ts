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
import { onRequestDelete, onRequestPut } from "../functions/api/tabs/[id]";

function makeTool(overrides: Partial<ToolShape> = {}): ToolShape {
  return {
    id: "tool-saw",
    name: "Table Saw",
    x: 10,
    y: 20,
    width: 96,
    height: 60,
    rotation: 0,
    color: "#db6b4d",
    activity: "wood",
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

type FakeTabRow = {
  author_id: string | null;
  name: string;
  layout_json: string;
  created_at: string;
  updated_at: string;
};

function makeTabRequest(tab: LayoutTab, headers: Record<string, string> = {}) {
  return new Request(`https://example.test/api/tabs/${tab.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Author-Id": "user-local", ...headers },
    body: JSON.stringify(tab),
  });
}

function makeDeleteRequest(tabId: string, headers: Record<string, string> = {}) {
  return new Request(`https://example.test/api/tabs/${tabId}`, {
    method: "DELETE",
    headers: { "X-Author-Id": "user-local", ...headers },
  });
}

function makeFakeEnv(initialRow: FakeTabRow | null) {
  let row = initialRow;
  let writes = 0;
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (sql.includes("FROM tabs WHERE id = ?")) return row;
                return null;
              },
              async run() {
                writes += 1;
                if (sql.includes("DELETE FROM tabs")) {
                  row = null;
                  return {};
                }
                row = {
                  author_id: args[2] as string | null,
                  name: args[1] as string,
                  layout_json: args[3] as string,
                  created_at: args[4] as string,
                  updated_at: args[5] as string,
                };
                return {};
              },
            };
          },
        };
      },
    },
  };

  return {
    env,
    get row() { return row; },
    get writes() { return writes; },
  };
}

describe("layout tab validation", () => {
  it("accepts a normal tab and returns canonical data", () => {
    const tab = parseLayoutTabValue(makeTab());

    expect(tab.id).toBe("now");
    expect(tab.name).toBe("Now");
    expect(tab.layout.unit).toBe("in");
    expect(tab.layout.tools[0].activity).toBe("wood");
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

  it("rejects invalid ids, names, numbers, colors, activities, and hazards", () => {
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
                activity: "not-an-activity" as ToolShape["activity"],
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

describe("tab API revision checks", () => {
  const serverRevision = "2026-04-30T02:00:00.000Z";
  const existingRow: FakeTabRow = {
    author_id: "user-local",
    name: "Owned Draft",
    layout_json: JSON.stringify(makeTab({ id: "tab-owned", name: "Owned Draft" }).layout),
    created_at: "2026-04-30T00:00:00.000Z",
    updated_at: serverRevision,
  };

  it("updates when the expected revision matches", async () => {
    const fake = makeFakeEnv({ ...existingRow });
    const response = await onRequestPut({
      env: fake.env,
      request: makeTabRequest(makeTab({ id: "tab-owned", name: "Renamed Draft" }), {
        "X-Expected-Updated-At": serverRevision,
      }),
      params: { id: "tab-owned" },
    } as any);

    expect(response.status).toBe(200);
    expect(fake.writes).toBe(1);
    expect(fake.row?.name).toBe("Renamed Draft");
  });

  it("rejects stale updates without altering the row", async () => {
    const fake = makeFakeEnv({ ...existingRow });
    const response = await onRequestPut({
      env: fake.env,
      request: makeTabRequest(makeTab({ id: "tab-owned", name: "Stale Draft" }), {
        "X-Expected-Updated-At": "2026-04-30T01:00:00.000Z",
      }),
      params: { id: "tab-owned" },
    } as any);

    expect(response.status).toBe(409);
    expect(fake.writes).toBe(0);
    expect(fake.row?.name).toBe("Owned Draft");
  });

  it("creates tabs without an expected revision", async () => {
    const fake = makeFakeEnv(null);
    const response = await onRequestPut({
      env: fake.env,
      request: makeTabRequest(makeTab({ id: "tab-new", name: "New Draft" })),
      params: { id: "tab-new" },
    } as any);

    expect(response.status).toBe(200);
    expect(fake.writes).toBe(1);
    expect(fake.row?.name).toBe("New Draft");
  });

  it("rejects stale deletes without deleting", async () => {
    const fake = makeFakeEnv({ ...existingRow });
    const response = await onRequestDelete({
      env: fake.env,
      request: makeDeleteRequest("tab-owned", {
        "X-Expected-Updated-At": "2026-04-30T01:00:00.000Z",
      }),
      params: { id: "tab-owned" },
    } as any);

    expect(response.status).toBe(409);
    expect(fake.writes).toBe(0);
    expect(fake.row).not.toBeNull();
  });

  it("deletes when the expected revision matches", async () => {
    const fake = makeFakeEnv({ ...existingRow });
    const response = await onRequestDelete({
      env: fake.env,
      request: makeDeleteRequest("tab-owned", {
        "X-Expected-Updated-At": serverRevision,
      }),
      params: { id: "tab-owned" },
    } as any);

    expect(response.status).toBe(200);
    expect(fake.writes).toBe(1);
    expect(fake.row).toBeNull();
  });
});
