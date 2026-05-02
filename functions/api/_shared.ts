export type Env = {
  DB: D1Database;
};

export type ToolShape = {
  id: string;
  assetId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  scope?:
    | "undefined"
    | "automotive"
    | "blue"
    | "electronics"
    | "glass/clay"
    | "green"
    | "lasers"
    | "media/vinyl/art"
    | "metal"
    | "plastics"
    | "red"
    | "social"
    | "software/it"
    | "textiles/leather"
    | "training"
    | "wood";
  hazards?: Array<"dust" | "noise" | "dirt" | "wet" | "fire" | "eyes">;
};

export type Layout = {
  unit: "in";
  tools: ToolShape[];
};

export type LayoutTab = {
  id: string;
  name: string;
  authorId?: string | null;
  canEdit?: boolean;
  hasLayout?: boolean;
  layout: Layout;
  createdAt?: string;
  updatedAt?: string;
};

export type TabRow = {
  id: string;
  name: string;
  author_id?: string | null;
  can_edit?: number | boolean | null;
  layout_json?: string | null;
  created_at: string;
  updated_at: string;
};

export const VALIDATION_LIMITS = {
  requestBytes: 256 * 1024,
  tabIdChars: 32,
  authorIdChars: 128,
  tabNameChars: 32,
  toolIdChars: 32,
  toolAssetIdChars: 128,
  toolNameChars: 40,
  toolsPerTab: 500,
  minCoordinate: -100000,
  maxCoordinate: 100000,
  minSize: 0.01,
  maxSize: 1440,
  minRotation: -36000,
  maxRotation: 36000,
  hazardsPerTool: 6,
} as const;

export const STATIC_NOW_TAB_ID = "now";
export const STATIC_NOW_TAB_NAME = "Now";
export const STATIC_NOW_LAYOUT: Layout = { unit: "in", tools: [] };

export const TAB_LIMITS = {
  perAuthor: 20,
  total: 2048,
} as const;

export type TabCreationLimit = "per-author" | "total";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TEXT_ENCODER = new TextEncoder();
const EMPTY_LAYOUT: Layout = { unit: "in", tools: [] };
const ALLOWED_SCOPES = new Set<NonNullable<ToolShape["scope"]>>([
  "undefined",
  "automotive",
  "blue",
  "electronics",
  "glass/clay",
  "green",
  "lasers",
  "media/vinyl/art",
  "metal",
  "plastics",
  "red",
  "social",
  "software/it",
  "textiles/leather",
  "training",
  "wood",
]);
const ALLOWED_HAZARDS = new Set<NonNullable<ToolShape["hazards"]>[number]>([
  "dust",
  "noise",
  "dirt",
  "wet",
  "fire",
  "eyes",
]);

type ValidationOptions = {
  root?: "tab" | "body";
};

export class ValidationError extends Error {
  details: string[];

  constructor(details: string[]) {
    super("Invalid tab payload");
    this.name = "ValidationError";
    this.details = details;
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

export function readAuthorIdHeader(request: Request) {
  const value = request.headers.get("X-Author-Id");
  if (!value) return null;
  if (value.length > VALIDATION_LIMITS.authorIdChars || !ID_PATTERN.test(value)) return null;
  return value;
}

export function readLayoutTab(row: TabRow): LayoutTab {
  const hasLayout = typeof row.layout_json === "string";
  const tab: LayoutTab = {
    id: row.id,
    name: row.name,
    hasLayout,
    layout: hasLayout ? JSON.parse(row.layout_json as string) as Layout : EMPTY_LAYOUT,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if ("author_id" in row) {
    tab.authorId = row.author_id ?? null;
  }
  if ("can_edit" in row) {
    tab.canEdit = Boolean(row.can_edit);
  }

  return tab;
}

export function publicLayoutTab(tab: LayoutTab): LayoutTab {
  const { authorId: _authorId, ...publicTab } = tab;
  return publicTab;
}

export function validationErrorResponse(error: ValidationError) {
  return json({ error: error.message, details: error.details }, { status: 400 });
}

export function tabCreationLimitResponse(limit: TabCreationLimit) {
  if (limit === "per-author") {
    return json(
      { error: `tab limit reached (${TAB_LIMITS.perAuthor} max per user)` },
      { status: 429 },
    );
  }

  return json(
    { error: `tab limit reached (${TAB_LIMITS.total} max total)` },
    { status: 429 },
  );
}

export async function readTabCreationLimit(db: D1Database, authorId: string): Promise<TabCreationLimit | null> {
  const [authorLimitRow, totalLimitRow] = await Promise.all([
    db
      .prepare(`SELECT 1 AS hit FROM tabs WHERE author_id = ? LIMIT 1 OFFSET ?`)
      .bind(authorId, TAB_LIMITS.perAuthor - 1)
      .first<{ hit: number }>(),
    db
      .prepare(`SELECT 1 AS hit FROM tabs LIMIT 1 OFFSET ?`)
      .bind(TAB_LIMITS.total - 1)
      .first<{ hit: number }>(),
  ]);

  if (authorLimitRow) return "per-author";
  if (totalLimitRow) return "total";
  return null;
}

export async function ensureStaticNowRow(db: D1Database) {
  await db.prepare(
    `INSERT OR IGNORE INTO tabs
      (id, name, author_id, layout_json)
      VALUES (?, ?, NULL, ?)`,
  )
    .bind(STATIC_NOW_TAB_ID, STATIC_NOW_TAB_NAME, JSON.stringify(STATIC_NOW_LAYOUT))
    .run();
}

export async function parseLayoutTabRequest(request: Request, options: ValidationOptions = {}) {
  const text = await request.text();
  if (TEXT_ENCODER.encode(text).length > VALIDATION_LIMITS.requestBytes) {
    throw new ValidationError([`request body must be at most ${VALIDATION_LIMITS.requestBytes} bytes`]);
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError(["request body must be valid JSON"]);
  }

  if (options.root === "tab") {
    const record = asRecord(body);
    return parseLayoutTabValue(record?.tab, "tab");
  }

  return parseLayoutTabValue(body, "tab");
}

export function parseLayoutTabValue(value: unknown, path = "tab"): LayoutTab {
  const details: string[] = [];
  const tab = asRecord(value);

  if (!tab) {
    throw new ValidationError([`${path} must be an object`]);
  }

  const layout = asRecord(tab.layout);
  if (!layout) {
    details.push(`${path}.layout must be an object`);
  }

  const createdAt = readNullableString(tab.createdAt, `${path}.createdAt`, 64, details);
  const updatedAt = readNullableString(tab.updatedAt, `${path}.updatedAt`, 64, details);
  const canonical: LayoutTab = {
    id: readId(tab.id, `${path}.id`, VALIDATION_LIMITS.tabIdChars, details),
    name: readString(tab.name, `${path}.name`, VALIDATION_LIMITS.tabNameChars, details, { trim: true }),
    authorId: readNullableId(tab.authorId, `${path}.authorId`, VALIDATION_LIMITS.authorIdChars, details),
    layout: {
      unit: "in",
      tools: [],
    },
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };

  if (layout) {
    if (layout.unit !== "in") {
      details.push(`${path}.layout.unit must be "in"`);
    }

    canonical.layout.tools = readArray(layout.tools, `${path}.layout.tools`, VALIDATION_LIMITS.toolsPerTab, details)
      .map((tool, index) => readTool(tool, `${path}.layout.tools[${index}]`, details));
  }

  if (details.length > 0) {
    throw new ValidationError(details);
  }

  return canonical;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readTool(value: unknown, path: string, details: string[]): ToolShape {
  const tool = asRecord(value);
  if (!tool) {
    details.push(`${path} must be an object`);
  }

  const canonical: ToolShape = {
    id: readId(tool?.id, `${path}.id`, VALIDATION_LIMITS.toolIdChars, details),
    assetId: readId(tool?.assetId, `${path}.assetId`, VALIDATION_LIMITS.toolAssetIdChars, details),
    name: readString(tool?.name, `${path}.name`, VALIDATION_LIMITS.toolNameChars, details, { trim: true }),
    x: readNumber(tool?.x, `${path}.x`, VALIDATION_LIMITS.minCoordinate, VALIDATION_LIMITS.maxCoordinate, details),
    y: readNumber(tool?.y, `${path}.y`, VALIDATION_LIMITS.minCoordinate, VALIDATION_LIMITS.maxCoordinate, details),
    width: readNumber(tool?.width, `${path}.width`, VALIDATION_LIMITS.minSize, VALIDATION_LIMITS.maxSize, details),
    height: readNumber(tool?.height, `${path}.height`, VALIDATION_LIMITS.minSize, VALIDATION_LIMITS.maxSize, details),
    rotation: readNumber(tool?.rotation, `${path}.rotation`, VALIDATION_LIMITS.minRotation, VALIDATION_LIMITS.maxRotation, details),
    color: readColor(tool?.color, `${path}.color`, details),
  };

  if (tool?.scope !== undefined && tool.scope !== null) {
    canonical.scope = readScope(tool.scope, `${path}.scope`, details);
  }

  if (tool?.hazards !== undefined && tool.hazards !== null) {
    canonical.hazards = readHazards(tool.hazards, `${path}.hazards`, details);
  }

  return canonical;
}

function readArray(value: unknown, path: string, maxLength: number, details: string[]) {
  if (!Array.isArray(value)) {
    details.push(`${path} must be an array`);
    return [];
  }

  if (value.length > maxLength) {
    details.push(`${path} must contain at most ${maxLength} items`);
    return value.slice(0, maxLength);
  }

  return value;
}

function readId(value: unknown, path: string, maxLength: number, details: string[]) {
  return readString(value, path, maxLength, details, { pattern: ID_PATTERN });
}

function readNullableId(value: unknown, path: string, maxLength: number, details: string[]) {
  return readNullableString(value, path, maxLength, details, { pattern: ID_PATTERN });
}

function readNullableString(
  value: unknown,
  path: string,
  maxLength: number,
  details: string[],
  options: { pattern?: RegExp; trim?: boolean } = {},
) {
  if (value === undefined || value === null) {
    return null;
  }

  return readString(value, path, maxLength, details, options);
}

function readString(
  value: unknown,
  path: string,
  maxLength: number,
  details: string[],
  options: { pattern?: RegExp; trim?: boolean } = {},
) {
  if (typeof value !== "string") {
    details.push(`${path} must be a string`);
    return "";
  }

  const text = options.trim ? value.trim() : value;
  if (text.length < 1) {
    details.push(`${path} must not be empty`);
  }
  if (text.length > maxLength) {
    details.push(`${path} must be at most ${maxLength} characters`);
  }
  if (options.pattern && !options.pattern.test(text)) {
    details.push(`${path} contains unsupported characters`);
  }

  return text;
}

function readNumber(value: unknown, path: string, min: number, max: number, details: string[]) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    details.push(`${path} must be a finite number`);
    return 0;
  }

  if (value < min || value > max) {
    details.push(`${path} must be between ${min} and ${max}`);
  }

  return value;
}

function readColor(value: unknown, path: string, details: string[]) {
  const color = readString(value, path, 7, details);
  if (!HEX_COLOR_PATTERN.test(color)) {
    details.push(`${path} must be a hex color`);
  }

  return color;
}

function readScope(value: unknown, path: string, details: string[]) {
  if (typeof value !== "string" || !ALLOWED_SCOPES.has(value as NonNullable<ToolShape["scope"]>)) {
    details.push(`${path} must be an allowed scope`);
    return "undefined";
  }

  return value as NonNullable<ToolShape["scope"]>;
}

function readHazards(value: unknown, path: string, details: string[]) {
  if (!Array.isArray(value)) {
    details.push(`${path} must be an array`);
    return [];
  }

  if (value.length > VALIDATION_LIMITS.hazardsPerTool) {
    details.push(`${path} must contain at most ${VALIDATION_LIMITS.hazardsPerTool} items`);
  }

  const seen = new Set<string>();
  const hazards: NonNullable<ToolShape["hazards"]> = [];
  for (const hazard of value) {
    if (typeof hazard !== "string" || !ALLOWED_HAZARDS.has(hazard as NonNullable<ToolShape["hazards"]>[number])) {
      details.push(`${path} contains an unsupported hazard`);
      continue;
    }
    if (seen.has(hazard)) {
      details.push(`${path} must not contain duplicate hazards`);
      continue;
    }
    seen.add(hazard);
    hazards.push(hazard as NonNullable<ToolShape["hazards"]>[number]);
  }

  return hazards;
}
