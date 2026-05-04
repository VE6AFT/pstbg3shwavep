import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TAB_LIMITS, VALIDATION_LIMITS } from "../functions/api/_shared";
import { readFailedSyncMessage } from "./apiErrors";
import nowSvg from "./assets/now.svg?raw";
import { DebugPanel } from "./DebugPanel";
import { seedTabs } from "./seed";
import { makeShortId } from "./shortId";
import { makeTabSlugId } from "./tabSlug";
import { isStaticNowTab, makeStaticNowTab, NOW_TAB_NAME, withStaticNowTab } from "./staticNow";
import { applyCachedLayout, clearTabCache, readCachedLayout, readCachedTabs, writeTabCacheSnapshot } from "./tabCache";
import { countClientAuthorTabs, isClientAuthorTabLimitReached } from "./tabLimits";
import { buildTabShareUrl, readSharedTabId, removeSharedTabFromUrl } from "./tabShare";
import {
  disketteStatusLabel,
  getDisketteStatus,
  hasFlushableTabs,
  isFlushableTab,
  isUnsyncedTab,
  mergeRemoteTabSummaries,
  stripSyncMetadata,
  visibleTabs,
  withSyncedState,
} from "./tabSync";
import type { LayoutTab, SaveResponse, ToolShape } from "./types";
import { useDebugPanel } from "./useDebugPanel";

const ACTIVE_TAB_STORAGE_KEY = "pstbg3shwavep-active-tab";
const CONTROLS_STORAGE_KEY = "pstbg3shwavep-controls";
const LOCAL_WRITE_DELAY_MS = 300;
const DEFAULT_SAVE_DELAY_MS = 5000;
const MISSING_LOCAL_LAYOUT_MESSAGE = "Local draft layout unavailable; changes were not synced";
const TAB_DELETE_CONFIRM_MS = 2200;
const SHARE_FEEDBACK_MS = 1800;
const SNAP_MODES = ["off", "top-left", "center"] as const;
const DIMS_MODES = ["off", "selected", "all"] as const;
const ROTATION_SNAP_DEGREES = 5;
const MAX_TAB_NAME_CHARS = VALIDATION_LIMITS.tabNameChars;
const MAX_TOOL_NAME_CHARS = VALIDATION_LIMITS.toolNameChars;
const MAX_TOOL_SIZE_INCHES = VALIDATION_LIMITS.maxSize;
const STATIC_TOOL_ACTIVITIES = new Set<NonNullable<ToolShape["activity"]>>([
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
  "storage",
  "textiles/leather",
  "training",
  "wood",
]);
const STATIC_TOOL_HAZARDS = new Set<NonNullable<ToolShape["hazards"]>[number]>([
  "dust",
  "noise",
  "dirt",
  "wet",
  "fire",
  "eyes",
]);

function loadControls() {
  try {
    const raw = localStorage.getItem(CONTROLS_STORAGE_KEY);
    return (raw ? JSON.parse(raw) : {}) as { gridDark?: boolean; snapMode?: SnapMode; dimsMode?: DimsMode; showInfra?: boolean; showMezz?: boolean };
  } catch {
    return {};
  }
}

const STAGE_PAD = 200;
const GRID_SIZE_INCHES = 12;
const ACTION_ZONE_KINDS = ["delete", "copy"] as const;
const ACTION_ZONE_DROP_PRIORITY = ["copy", "delete"] as const;

type ActionZoneKind = typeof ACTION_ZONE_KINDS[number];
type ActionZoneCenter = { x: number; y: number } | null;

type DragState = {
  pointerId: number;
  tabId: string;
  toolId: string;
  offsetX: number;
  offsetY: number;
  originalX: number;
  originalY: number;
  latestX: number;
  latestY: number;
  width: number;
  height: number;
  rotation: number;
  element: SVGGElement;
  inverseScreenMatrix: DOMMatrix;
  actionZoneCenters: Record<ActionZoneKind, ActionZoneCenter>;
  activeActionZone: ActionZoneKind | null;
} | null;
type RotateDragState = {
  pointerId: number;
  tabId: string;
  toolId: string;
  originalRotation: number;
  latestRotation: number;
  startAngle: number;
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  element: SVGGElement;
  inverseScreenMatrix: DOMMatrix;
} | null;
type ViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};
type PanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewBox: ViewBox;
  svgWidth: number;
  svgHeight: number;
} | null;
type ClonePrompt = {
  tabId: string;
  run: number;
} | null;
type TutorialStep = "overview";
type SnapMode = typeof SNAP_MODES[number];
type DimsMode = typeof DIMS_MODES[number];
type ShareStatus = "idle" | "copied" | "failed";

const ACTION_ZONES: Record<ActionZoneKind, {
  className: string;
  ariaLabel: string;
  dirtyMessage: string;
}> = {
  delete: {
    className: "delete",
    ariaLabel: "Drop here to delete",
    dirtyMessage: "Deleted tool",
  },
  copy: {
    className: "copy",
    ariaLabel: "Drop here to copy",
    dirtyMessage: "Copied tool",
  },
};

function parseSvgViewBox(markup: string): ViewBox {
  const match = markup.match(/\bviewBox=["']([^"']+)["']/i);
  if (!match) throw new Error("now.svg must define a viewBox");

  const values = match[1].trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("now.svg viewBox must contain four finite numbers");
  }

  const [minX, minY, width, height] = values;
  return { minX, minY, width, height };
}

function extractSvgBody(markup: string) {
  const match = markup.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) throw new Error("now.svg must contain an <svg> root");
  return match[1].trim();
}

function parseSvgDocument(markup: string) {
  if (typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (document.querySelector("parsererror")) return null;
  return document;
}

function normalizeLayerLabel(value: string | null) {
  return value?.trim().toLowerCase();
}

function removeInlineDisplay(element: Element) {
  const style = element.getAttribute("style");
  if (!style) return;

  const nextStyle = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !declaration.toLowerCase().startsWith("display:"))
    .join(";");

  if (nextStyle) element.setAttribute("style", nextStyle);
  else element.removeAttribute("style");
}

function isToolLayer(element: Element) {
  return element.id === "layer-tools"
    || normalizeLayerLabel(element.getAttribute("inkscape:label")) === "tools"
    || element.getAttribute("data-layer") === "tools";
}

function normalizeStaticSvgLayers(document: Document) {
  Array.from(document.querySelectorAll("g")).forEach((element) => {
    const layer = normalizeLayerLabel(element.getAttribute("inkscape:label") ?? element.getAttribute("data-layer"));
    if (layer === "mezzanine") {
      element.classList.add("mezzanine-layer");
      element.setAttribute("data-layer", "mezzanine");
      removeInlineDisplay(element);
    }
    if (layer === "infrastructure" || layer === "infra") {
      element.classList.add("infra-layer");
      element.setAttribute("data-layer", "infrastructure");
      removeInlineDisplay(element);
    }
  });
}

function removeExportedLayerVisibilityStyles(document: Document) {
  Array.from(document.querySelectorAll("style")).forEach((element) => {
    const text = element.textContent;
    if (!text || !/\.infra-layer|\.mezzanine-layer/.test(text)) return;

    const nextText = text
      .replace(/\.infra-layer\s*\{\s*display\s*:\s*(?:block|none)\s*\}/gi, "")
      .replace(/\.mezzanine-layer\s*\{\s*display\s*:\s*(?:block|none)\s*\}/gi, "")
      .trim();

    if (nextText) element.textContent = nextText;
    else element.remove();
  });
}

function normalizeStaticSvgDocument(document: Document) {
  removeExportedLayerVisibilityStyles(document);
  normalizeStaticSvgLayers(document);
}

function serializeSvgBody(document: Document) {
  return Array.from(document.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("\n")
    .trim();
}

function staticToolLayers(document: Document) {
  return Array.from(document.querySelectorAll("g")).filter(isToolLayer);
}

function readStaticToolActivity(value: string | null) {
  if (!value || !STATIC_TOOL_ACTIVITIES.has(value as NonNullable<ToolShape["activity"]>)) return undefined;
  return value as NonNullable<ToolShape["activity"]>;
}

function readStaticToolHazards(value: string | null) {
  if (!value) return undefined;
  const hazards = value
    .split(",")
    .map((hazard) => hazard.trim())
    .filter((hazard): hazard is NonNullable<ToolShape["hazards"]>[number] =>
      STATIC_TOOL_HAZARDS.has(hazard as NonNullable<ToolShape["hazards"]>[number]),
    );
  return hazards.length > 0 ? Array.from(new Set(hazards)) : undefined;
}

function readNumberAttribute(element: Element | null, name: string, fallback = 0) {
  const value = element?.getAttribute(name);
  const number = value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readTranslate(transform: string | null) {
  const match = transform?.match(/translate\(\s*(-?\d+(?:\.\d+)?)(?:[\s,]+(-?\d+(?:\.\d+)?))?\s*\)/i);
  if (!match) return { x: 0, y: 0 };
  return {
    x: Number(match[1]),
    y: Number(match[2] ?? 0),
  };
}

function readRotation(transform: string | null) {
  const match = transform?.match(/rotate\(\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return 0;
  return Number(match[1]);
}

function extractStaticNowTools(markup: string): ToolShape[] {
  const document = parseSvgDocument(markup);
  if (!document) return [];

  return staticToolLayers(document).flatMap((layer) =>
    Array.from(layer.children)
      .filter((child): child is SVGGElement => child.tagName.toLowerCase() === "g" && Boolean(child.id))
      .map((group) => {
        const rect = group.querySelector("rect");
        const translate = readTranslate(group.getAttribute("transform"));
        const x = translate.x + readNumberAttribute(rect, "x");
        const y = translate.y + readNumberAttribute(rect, "y");
        const color = group.getAttribute("data-tool-color")
          ?? rect?.getAttribute("stroke")
          ?? rect?.getAttribute("fill")
          ?? "#697074";
        const activity = readStaticToolActivity(group.getAttribute("data-tool-activity"));
        const hazards = readStaticToolHazards(group.getAttribute("data-tool-hazards"));

        return {
          id: group.id,
          name: group.getAttribute("inkscape:label")
            ?? group.getAttribute("aria-label")
            ?? group.querySelector("text")?.textContent?.trim()
            ?? group.id,
          x,
          y,
          width: readNumberAttribute(rect, "width", VALIDATION_LIMITS.minSize),
          height: readNumberAttribute(rect, "height", VALIDATION_LIMITS.minSize),
          rotation: readRotation(group.getAttribute("transform")),
          color,
          ...(activity ? { activity } : {}),
          ...(hazards ? { hazards } : {}),
        };
      }),
  );
}

function stripStaticToolLayers(markup: string) {
  const document = parseSvgDocument(markup);
  if (!document || typeof XMLSerializer === "undefined") return extractSvgBody(markup);

  normalizeStaticSvgDocument(document);
  staticToolLayers(document).forEach((layer) => layer.remove());
  return serializeSvgBody(document);
}

function normalizeStaticSvgMarkup(markup: string) {
  const document = parseSvgDocument(markup);
  if (!document || typeof XMLSerializer === "undefined") return extractSvgBody(markup);

  normalizeStaticSvgDocument(document);
  return serializeSvgBody(document);
}

const NOW_VIEWBOX = parseSvgViewBox(nowSvg);
const NOW_MARKUP = normalizeStaticSvgMarkup(nowSvg);
const NOW_GEOMETRY_MARKUP = stripStaticToolLayers(nowSvg);
const STATIC_NOW_TAB = makeStaticNowTab({
  unit: "in",
  tools: extractStaticNowTools(nowSvg),
});
const CONTENT_BOUNDS = {
  minX: NOW_VIEWBOX.minX,
  minY: NOW_VIEWBOX.minY,
  maxX: NOW_VIEWBOX.minX + NOW_VIEWBOX.width,
  maxY: NOW_VIEWBOX.minY + NOW_VIEWBOX.height,
};
const STAGE_BOUNDS = {
  minX: CONTENT_BOUNDS.minX - STAGE_PAD,
  minY: CONTENT_BOUNDS.minY - STAGE_PAD,
  maxX: CONTENT_BOUNDS.maxX + STAGE_PAD,
  maxY: CONTENT_BOUNDS.maxY + STAGE_PAD,
};
const FULL_VIEWBOX: ViewBox = {
  minX: STAGE_BOUNDS.minX,
  minY: STAGE_BOUNDS.minY,
  width: STAGE_BOUNDS.maxX - STAGE_BOUNDS.minX,
  height: STAGE_BOUNDS.maxY - STAGE_BOUNDS.minY,
};
const MIN_ZOOM_WIDTH = FULL_VIEWBOX.width / 8;
const MIN_ZOOM_HEIGHT = FULL_VIEWBOX.height / 8;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getOrCreateUserId() {
  const key = "pstbg3shwavep-user-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uid("user");
    localStorage.setItem(key, id);
  }
  return id;
}

function inchesToFeetInches(value: number) {
  const sign = value < 0 ? "-" : "";
  const total = Math.round(Math.abs(value));
  const feet = Math.floor(total / 12);
  const inches = total % 12;
  const parts = [
    feet > 0 ? `${feet}'` : "",
    inches > 0 ? `${inches}"` : "",
  ].filter(Boolean);
  return `${sign}${parts.length > 0 ? parts.join(" ") : `0"`}`;
}

function normalizeTabName(name: string | null | undefined, fallback: string) {
  const trimmed = name?.trim() ?? "";
  return (trimmed || fallback).slice(0, MAX_TAB_NAME_CHARS);
}

function normalizeToolName(name: string) {
  return name.trim().slice(0, MAX_TOOL_NAME_CHARS);
}

function tabSortTime(tab: LayoutTab) {
  const value = tab.createdAt ?? tab.updatedAt;
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function orderTabs(tabs: LayoutTab[]) {
  return [...tabs].sort((a, b) => {
    const aNow = isStaticNowTab(a);
    const bNow = isStaticNowTab(b);
    if (aNow !== bNow) return aNow ? -1 : 1;
    if (aNow && bNow) return 0;

    const byTime = tabSortTime(a) - tabSortTime(b);
    if (byTime !== 0) return byTime;
    return a.name.localeCompare(b.name);
  });
}

function estimateJsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function formatKiB(bytes: number) {
  const kib = bytes / 1024;
  return `${kib >= 10 ? kib.toFixed(0) : kib.toFixed(1)} KiB`;
}

function normalizeTab(tab: LayoutTab, index = 0): LayoutTab {
  if (isStaticNowTab(tab)) return STATIC_NOW_TAB;

  const fallbackName = `Sheet ${index + 1}`;

  return {
    ...tab,
    name: normalizeTabName(tab.name, fallbackName),
    canEdit: tab.canEdit ?? false,
    hasLayout: tab.hasLayout ?? true,
    syncState: tab.syncState ?? "synced",
    layout: {
      ...tab.layout,
      tools: tab.layout.tools.map((tool) => clampTool(tool)),
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampToolPosition(tool: Pick<ToolShape, "width" | "height">, x: number, y: number) {
  return {
    x: clamp(x, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX - tool.width),
    y: clamp(y, STAGE_BOUNDS.minY, STAGE_BOUNDS.maxY - tool.height),
  };
}

function snapToGrid(value: number) {
  return Math.round(value / GRID_SIZE_INCHES) * GRID_SIZE_INCHES;
}

function snapToolTopLeftPosition(tool: Pick<ToolShape, "width" | "height">, x: number, y: number) {
  return clampToolPosition(tool, snapToGrid(x), snapToGrid(y));
}

function snapToolCenterPosition(tool: Pick<ToolShape, "width" | "height">, x: number, y: number) {
  const snappedCenterX = snapToGrid(x + tool.width / 2);
  const snappedCenterY = snapToGrid(y + tool.height / 2);
  return clampToolPosition(tool, snappedCenterX - tool.width / 2, snappedCenterY - tool.height / 2);
}

function snapToolPosition(tool: Pick<ToolShape, "width" | "height">, x: number, y: number, mode: SnapMode) {
  if (mode === "top-left") return snapToolTopLeftPosition(tool, x, y);
  if (mode === "center") return snapToolCenterPosition(tool, x, y);
  return clampToolPosition(tool, x, y);
}

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360;
}

function snapRotation(value: number) {
  return normalizeRotation(Math.round(value / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES);
}

function angleDegreesFromCenter(centerX: number, centerY: number, pointX: number, pointY: number) {
  return Math.atan2(pointY - centerY, pointX - centerX) * 180 / Math.PI;
}

function actionZoneProximity(clientX: number, clientY: number, center: { x: number; y: number } | null) {
  if (!center) return { level: 0, isOver: false };
  const dist = Math.hypot(clientX - center.x, clientY - center.y);
  return {
    level: dist < 32 ? 1 : Math.max(0, 1 - dist / 500),
    isOver: dist < 32,
  };
}

function isSnapMode(value: unknown): value is SnapMode {
  return typeof value === "string" && SNAP_MODES.includes(value as SnapMode);
}

function isDimsMode(value: unknown): value is DimsMode {
  return typeof value === "string" && DIMS_MODES.includes(value as DimsMode);
}

function nextSnapMode(mode: SnapMode): SnapMode {
  const index = SNAP_MODES.indexOf(mode);
  return SNAP_MODES[(index + 1) % SNAP_MODES.length];
}

function nextDimsMode(mode: DimsMode): DimsMode {
  const index = DIMS_MODES.indexOf(mode);
  return DIMS_MODES[(index + 1) % DIMS_MODES.length];
}

function snapModeLabel(mode: SnapMode) {
  if (mode === "top-left") return "top-left";
  if (mode === "center") return "center";
  return "off";
}

function dimsModeLabel(mode: DimsMode) {
  if (mode === "selected") return "selected";
  if (mode === "all") return "all";
  return "off";
}

function clampTool(tool: ToolShape): ToolShape {
  const position = clampToolPosition(tool, tool.x, tool.y);
  return {
    ...tool,
    ...position,
  };
}

function toolTransform(tool: Pick<ToolShape, "x" | "y" | "width" | "height" | "rotation">) {
  return `translate(${tool.x} ${tool.y}) rotate(${tool.rotation} ${tool.width / 2} ${tool.height / 2})`;
}

function isSamePersistedDraft(current: LayoutTab, draft: LayoutTab) {
  return current.name === draft.name
    && current.syncState === draft.syncState
    && current.dirtyAt === draft.dirtyAt
    && current.updatedAt === draft.updatedAt
    && JSON.stringify(current.layout) === JSON.stringify(draft.layout);
}

function svgPointFromMatrix(matrix: DOMMatrix, clientX: number, clientY: number) {
  return new DOMPoint(clientX, clientY).matrixTransform(matrix);
}

function clampViewBox(viewBox: ViewBox): ViewBox {
  const width = clamp(viewBox.width, MIN_ZOOM_WIDTH, FULL_VIEWBOX.width);
  const height = clamp(viewBox.height, MIN_ZOOM_HEIGHT, FULL_VIEWBOX.height);
  return {
    minX: clamp(viewBox.minX, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX - width),
    minY: clamp(viewBox.minY, STAGE_BOUNDS.minY, STAGE_BOUNDS.maxY - height),
    width,
    height,
  };
}

function cloneLayoutTab(source: LayoutTab, existingTabIds: Iterable<string>): LayoutTab {
  const nextTabId = makeTabSlugId(existingTabIds);
  const now = new Date().toISOString();
  const nextToolIds = new Set(source.layout.tools.map((tool) => tool.id));

  return {
    ...source,
    id: nextTabId,
    name: nextTabId,
    createdAt: now,
    updatedAt: undefined,
    layout: {
      ...source.layout,
      tools: source.layout.tools.map((tool) => {
        const id = makeShortId("tool", nextToolIds);
        nextToolIds.add(id);
        return {
          ...tool,
          id,
        };
      }),
    },
  };
}

async function fetchTabs(authorId: string) {
  const response = await fetch("/api/tabs", {
    headers: { "X-Author-Id": authorId },
  });
  if (!response.ok) {
    throw new Error(`Failed to load tabs: ${response.status}`);
  }
  return (await response.json()) as { tabs: LayoutTab[] };
}

class RequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

async function readRequestErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? fallback;
}

async function fetchTab(tabId: string, authorId: string) {
  const response = await fetch(`/api/tabs/${tabId}`, {
    headers: { "X-Author-Id": authorId },
  });
  if (!response.ok) {
    throw new Error(`Failed to load tab: ${response.status}`);
  }
  return (await response.json()) as SaveResponse;
}

async function saveTab(tab: LayoutTab, authorId: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Author-Id": authorId };
  if (tab.updatedAt) {
    headers["X-Expected-Updated-At"] = tab.updatedAt;
  }
  const response = await fetch(`/api/tabs/${tab.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(stripSyncMetadata(tab)),
  });

  if (!response.ok) {
    throw new RequestError(await readRequestErrorMessage(response, `Failed to save tab: ${response.status}`), response.status);
  }

  return (await response.json()) as SaveResponse;
}

class LimitError extends Error { }

const TERMINAL_SYNC_STATUSES = new Set([400, 401, 403, 409, 422, 429]);

function isTabCreationLimitError(error: unknown) {
  return error instanceof LimitError
    || (error instanceof RequestError && error.status === 429);
}

function isTerminalSyncError(error: unknown) {
  return error instanceof LimitError
    || (error instanceof RequestError && error.status !== undefined && TERMINAL_SYNC_STATUSES.has(error.status));
}

function syncErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to sync local changes";
}

async function persistClone(tab: LayoutTab, authorId: string) {
  const response = await fetch("/api/tabs/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Author-Id": authorId },
    body: JSON.stringify({ tab: stripSyncMetadata(tab) }),
  });

  if (response.status === 429) {
    const error = new LimitError(await readFailedSyncMessage(response));
    error.cause = response.status;
    throw error;
  }

  if (!response.ok) {
    throw new RequestError(await readRequestErrorMessage(response, `Failed to clone tab: ${response.status}`), response.status);
  }

  return (await response.json()) as SaveResponse;
}

async function deleteTabFromDb(tabId: string, authorId: string, expectedUpdatedAt?: string) {
  const headers: Record<string, string> = { "X-Author-Id": authorId };
  if (expectedUpdatedAt) {
    headers["X-Expected-Updated-At"] = expectedUpdatedAt;
  }
  const response = await fetch(`/api/tabs/${tabId}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    throw new RequestError(await readRequestErrorMessage(response, `Failed to delete tab: ${response.status}`), response.status);
  }
}

function loadActiveTabId(tabs?: LayoutTab[]) {
  try {
    const activeTabId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (!activeTabId) return null;
    return tabs && !tabs.some((tab) => tab.id === activeTabId) ? null : activeTabId;
  } catch {
    return null;
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the textarea path for browsers that expose but reject clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed");
    }
  } finally {
    textarea.remove();
  }
}

function isShareableTab(tab: LayoutTab | undefined) {
  return Boolean(tab && !isStaticNowTab(tab) && tab.syncState !== "local-only" && tab.syncState !== "draft-clone");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFor(tabName: string, extension: string) {
  const safeName = tabName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "floorplan";
  return `${safeName}.${extension}`;
}


function parseFeetInches(val: string): number {
  if (!val.trim()) return 0;
  if (/^\d+(\.\d+)?$/.test(val.trim())) return parseFloat(val);
  let totalInches = 0;
  const feetMatch = val.match(/(\d+(?:\.\d+)?)\s*'/);
  if (feetMatch) totalInches += parseFloat(feetMatch[1]) * 12;
  const inchesMatch = val.match(/(\d+(?:\.\d+)?)\s*"/);
  if (inchesMatch) totalInches += parseFloat(inchesMatch[1]);
  if (!feetMatch && !inchesMatch) return parseFloat(val) || 0;
  return totalInches;
}

function isValidToolSize(value: number) {
  return Number.isFinite(value) && value >= VALIDATION_LIMITS.minSize && value <= MAX_TOOL_SIZE_INCHES;
}

const ACTIVITY_COLORS = {
  undefined: "#697074",
  automotive: "#2c3e50",
  electronics: "#27ae60",
  "glass/clay": "#d4a373",
  lasers: "#c0392b",
  "media/vinyl/art": "#8e44ad",
  metal: "#2980b9",
  plastics: "#16a085",
  social: "#e67e22",
  "software/it": "#34495e",
  storage: "#a1a1aa",
  "textiles/leather": "#936639",
  training: "#29b6f6",
  wood: "#f1c40f",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
} as const;

function DisketteStatusIcon({
  status,
  label,
  offline,
  syncError,
  persistentTooltip,
}: {
  status: ReturnType<typeof getDisketteStatus>;
  label: string;
  offline: boolean;
  syncError?: string;
  persistentTooltip?: boolean;
}) {
  const statusLabel = syncError ? `${label}: ${syncError}` : label;

  return (
    <div
      className={`diskette-status ${status} ${offline ? "offline" : ""} ${persistentTooltip ? "persistent-tooltip" : ""}`}
      aria-label={statusLabel}
      data-tooltip={syncError || undefined}
      role="status"
      tabIndex={syncError ? 0 : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="disk-body" d="M4 3h13l3 3v15H4V3Z" />
        <path className="disk-label" d="M7 3v7h10V3" />
        <path className="disk-slot" d="M8 17h8" />
        {status === "dirty" && (
          <g className="disk-badge warning">
            <circle cx="17.5" cy="17.5" r="4" />
            <path d="M17.5 14.9v3" />
            <path d="M17.5 20.1h.01" />
          </g>
        )}
        {(status === "saving" || status === "synced") && (
          <g className="disk-badge success">
            <circle cx="17.5" cy="17.5" r="4" />
            <path d="m15.4 17.4 1.4 1.4 2.8-3" />
          </g>
        )}
      </svg>
    </div>
  );
}

function ActionZoneIcon({ kind }: { kind: ActionZoneKind }) {
  if (kind === "copy") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 8h10v10H8Z" />
        <path d="M6 16H5c-1 0-2-1-2-2V5c0-1 1-2 2-2h9c1 0 2 1 2 2v1" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function App() {
  const [localUserId] = useState(() => getOrCreateUserId());
  const [sharedTabId] = useState(() => readSharedTabId());
  const [tabs, setTabs] = useState<LayoutTab[]>(() => orderTabs(withStaticNowTab(seedTabs.map(normalizeTab), STATIC_NOW_TAB)));
  const [activeTabId, setActiveTabId] = useState(() => {
    if (sharedTabId && visibleTabs(tabs).some((tab) => tab.id === sharedTabId)) return sharedTabId;
    return loadActiveTabId() ?? tabs[0]?.id ?? seedTabs[0].id;
  });
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [gridDark, setGridDark] = useState(() => loadControls().gridDark ?? true);
  const [snapMode, setSnapMode] = useState<SnapMode>(() => {
    const mode = loadControls().snapMode;
    return isSnapMode(mode) ? mode : "top-left";
  });
  const [dimsMode, setDimsMode] = useState<DimsMode>(() => {
    const mode = loadControls().dimsMode;
    return isDimsMode(mode) ? mode : "selected";
  });
  const [showInfra, setShowInfra] = useState(() => loadControls().showInfra ?? true);
  const [showMezz, setShowMezz] = useState(() => loadControls().showMezz ?? true);
  const debugPanel = useDebugPanel();
  const [showAddTool, setShowAddTool] = useState(false);
  const [addToolForm, setAddToolForm] = useState({
    name: "",
    x: "",
    y: "",
    activity: "undefined" as NonNullable<ToolShape["activity"]>,
    hazards: [] as NonNullable<ToolShape["hazards"]>,
  });
  const [addToolErrors, setAddToolErrors] = useState<Record<string, boolean>>({});
  const [draggingToolId, setDraggingToolId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [viewBox, setViewBox] = useState<ViewBox>(FULL_VIEWBOX);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingDeleteTabId, setConfirmingDeleteTabId] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const actionZoneRefs = useRef<Record<ActionZoneKind, HTMLDivElement | null>>({
    delete: null,
    copy: null,
  });
  const activeTabButtonRef = useRef<HTMLElement | null>(null);
  const dragState = useRef<DragState>(null);
  const rotateDragState = useRef<RotateDragState>(null);
  const panState = useRef<PanState>(null);
  const syncFlushTimer = useRef<number | null>(null);
  const localWriteTimer = useRef<number | null>(null);
  const saveDelayMs = useRef<number>(DEFAULT_SAVE_DELAY_MS);
  const [tutorialStep, setTutorialStep] = useState<null | TutorialStep>(null);
  const [clonePrompt, setClonePrompt] = useState<ClonePrompt>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [dbReachable, setDbReachable] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [syncInFlight, setSyncInFlight] = useState(false);
  const [tabCreationLimitMessage, setTabCreationLimitMessage] = useState<string | null>(null);
  const actionZoneProximityRefs = useRef<Record<ActionZoneKind, number>>({
    delete: 0,
    copy: 0,
  });
  const tabsRef = useRef<LayoutTab[]>(tabs);
  const syncInFlightRef = useRef(false);
  const deferredSyncFlushRef = useRef(false);
  const cacheWriteInFlightRef = useRef(false);
  const queuedCacheSnapshotRef = useRef<LayoutTab[] | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const deleteConfirmTimerRef = useRef<number | null>(null);
  const shareFeedbackTimerRef = useRef<number | null>(null);
  const sharedTabUrlCleanedRef = useRef(false);
  const clonePromptRunRef = useRef(0);
  const localAuthorTabCountRef = useRef(0);
  const initialized = useRef(false);

  const displayedTabs = visibleTabs(tabs);
  const activeTab = displayedTabs.find((tab) => tab.id === activeTabId) ?? displayedTabs[0] ?? tabs[0];
  const activeTabIsStaticNow = isStaticNowTab(activeTab);
  const activeTabHasLayout = activeTab?.hasLayout !== false;
  const selectedTool = activeTabHasLayout ? activeTab?.layout.tools.find((tool) => tool.id === selectedToolId) ?? null : null;
  const isTutorialActive = tutorialStep !== null;
  const canOfferClone = !tabCreationLimitMessage && !isClientAuthorTabLimitReached(tabs, localUserId);
  const canShareActiveTab = isShareableTab(activeTab);
  const shareTooltip = !canShareActiveTab
    ? undefined
    : shareStatus === "copied"
      ? "copied link"
      : shareStatus === "failed"
        ? "copy failed"
        : "copy link";

  const canEdit = activeTabHasLayout && !activeTabIsStaticNow && (activeTab.canEdit === true || activeTab.authorId === localUserId);
  const shouldPromptForClone = !canEdit;
  const pushDebugEvent = debugPanel.pushEvent;
  const syncErrorTab = activeTab?.syncError
    ? activeTab
    : displayedTabs.find((tab) => tab.syncError);
  const syncErrorMessageForDiskette = syncErrorTab?.syncError
    ? syncErrorTab.id === activeTab?.id
      ? syncErrorTab.syncError
      : `${syncErrorTab.name}: ${syncErrorTab.syncError}`
    : undefined;
  const persistentDisketteMessage = tabCreationLimitMessage ?? syncErrorMessageForDiskette;
  const disketteStatus = persistentDisketteMessage
    ? "dirty"
    : getDisketteStatus(activeTab ? [activeTab] : [], dbReachable, syncInFlight);
  const disketteLabel = tabCreationLimitMessage
    ? "Tab creation blocked"
    : syncErrorTab
      ? "Sync rejected"
      : disketteStatusLabel(disketteStatus, dbReachable);
  const disketteSyncError = persistentDisketteMessage;

  const setActiveTabElement = useCallback((element: HTMLElement | null) => {
    activeTabButtonRef.current = element;
  }, []);

  const setActionZoneElement = useCallback((kind: ActionZoneKind, element: HTMLDivElement | null) => {
    actionZoneRefs.current[kind] = element;
  }, []);

  const flashShareStatus = useCallback((status: ShareStatus) => {
    if (shareFeedbackTimerRef.current) window.clearTimeout(shareFeedbackTimerRef.current);
    setShareStatus(status);
    shareFeedbackTimerRef.current = window.setTimeout(() => {
      shareFeedbackTimerRef.current = null;
      setShareStatus("idle");
    }, SHARE_FEEDBACK_MS);
  }, []);

  const triggerClonePrompt = useCallback((tabId = activeTabId) => {
    if (tabCreationLimitMessage) return;
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    clonePromptRunRef.current += 1;
    const run = clonePromptRunRef.current;
    setClonePrompt({ tabId, run });
    flashTimerRef.current = window.setTimeout(() => {
      setClonePrompt((current) => {
        if (current?.run !== run) return current;
        flashTimerRef.current = null;
        return null;
      });
    }, 900);
  }, [activeTabId, tabCreationLimitMessage]);

  const paintActionZone = useCallback((kind: ActionZoneKind, level: number, shaking: boolean) => {
    const clampedLevel = clamp(level, 0, 1);
    const zone = actionZoneRefs.current[kind];
    if (!zone) return;
    zone.style.setProperty("--action-zone-level", String(clampedLevel));
    zone.style.setProperty("--action-zone-opacity", String(0.2 + clampedLevel * 0.8));
    zone.classList.toggle("shaking", shaking);
  }, []);

  const paintActionZoneKind = useCallback((kind: ActionZoneKind, level: number) => {
    const clampedLevel = clamp(level, 0, 1);
    actionZoneProximityRefs.current[kind] = clampedLevel;
    const visibleLevel = Math.max(clampedLevel, isTutorialActive ? 1 : 0);
    paintActionZone(kind, visibleLevel, clampedLevel === 1);
  }, [isTutorialActive, paintActionZone]);

  const resetActionZones = useCallback(() => {
    ACTION_ZONE_KINDS.forEach((kind) => paintActionZoneKind(kind, 0));
  }, [paintActionZoneKind]);

  /**
   * Marks a tab as having unsynced local changes and schedules a background flush.
   * @param tabId The ID of the tab to mark dirty.
   * @param message Debug message describing the reason for the change.
   * @param delayMs Optional delay before flushing to the server (debouncing).
   * @param options.flushDraftClone If true, converts a 'draft-clone' into a 'local-only' tab immediately.
   */
  const markTabDirty = useCallback((tabId: string, message: string, delayMs: number = DEFAULT_SAVE_DELAY_MS, options: { flushDraftClone?: boolean } = {}) => {
    const dirtyAt = new Date().toISOString();
    saveDelayMs.current = delayMs;
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabId) return tab;
        const shouldFlushDraftClone = options.flushDraftClone ?? true;
        const syncState: LayoutTab["syncState"] = tab.syncState === "local-only"
          ? "local-only"
          : tab.syncState === "draft-clone" && shouldFlushDraftClone
            ? "local-only"
            : tab.syncState === "draft-clone"
              ? "draft-clone"
              : "dirty";
        return {
          ...tab,
          syncState,
          dirtyAt,
          syncError: undefined,
        };
      }),
    );
    pushDebugEvent(`queued write (${message})`);
  }, [pushDebugEvent]);

  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }, []);

  /**
   * The core background sync loop.
   * It identifies tabs that need to be saved, created, or deleted and performs the API calls.
   * It handles sequential processing and transient error recovery.
   */
  const flushUnsyncedTabs = useCallback(async () => {
    if (dragState.current) {
      // Defer sync if the user is currently dragging an object to avoid jank
      deferredSyncFlushRef.current = true;
      return;
    }
    if (syncInFlightRef.current || !dbReachable) return;
    const candidates = tabsRef.current.filter(isFlushableTab);
    if (candidates.length === 0) return;

    syncInFlightRef.current = true;
    setSyncInFlight(true);

    try {
      for (const candidate of candidates) {
        const draft = tabsRef.current.find((tab) => tab.id === candidate.id);
        if (!draft || !isFlushableTab(draft)) continue;

        try {
          if (draft.syncState === "delete-pending") {
            pushDebugEvent("delete retry start");
            await deleteTabFromDb(draft.id, localUserId, draft.updatedAt);
            setDbReachable(true);
            setTabs((current) => current.filter((tab) => tab.id !== draft.id));
            pushDebugEvent("delete ok");
            continue;
          }

          if (draft.syncState === "local-only") {
            pushDebugEvent("clone retry start");
            const { tab } = await persistClone(normalizeTab(draft), localUserId);
            setDbReachable(true);
            setTabs((current) => orderTabs(current.map((item) => {
              if (item.id !== draft.id) return item;
              if (!isSamePersistedDraft(item, draft)) {
                deferredSyncFlushRef.current = true;
                return {
                  ...item,
                  syncState: "dirty",
                  syncError: undefined,
                  createdAt: tab.createdAt ?? item.createdAt,
                  updatedAt: tab.updatedAt ?? item.updatedAt,
                  canEdit: tab.canEdit ?? item.canEdit,
                };
              }
              return withSyncedState(normalizeTab(tab));
            })));
            pushDebugEvent("clone ok");
            continue;
          }

          pushDebugEvent("save start");
          const { tab } = await saveTab(normalizeTab(draft), localUserId);
          setDbReachable(true);
          setTabs((current) => current.map((item) => {
            if (item.id !== tab.id) return item;
            if (!isSamePersistedDraft(item, draft)) {
              deferredSyncFlushRef.current = true;
              return item;
            }
            return withSyncedState(normalizeTab(tab));
          }));
          pushDebugEvent("save ok");
        } catch (err) {
          if (isTabCreationLimitError(err)) {
            const message = syncErrorMessage(err);
            setTabCreationLimitMessage(message);
            pushDebugEvent(`tab creation blocked: ${message}`);
          }

          if (draft.syncState === "local-only" && err instanceof LimitError) {
            setDbReachable(true);
            localAuthorTabCountRef.current = Math.max(0, localAuthorTabCountRef.current - 1);
            setTabs((current) => current.filter((tab) => tab.id !== draft.id));
            setActiveTabId((current) => (current === draft.id ? STATIC_NOW_TAB.id : current));
            continue;
          }

          if (isTerminalSyncError(err)) {
            setDbReachable(true);
            const message = syncErrorMessage(err);
            setTabs((current) =>
              current.map((tab) => (tab.id === draft.id ? { ...tab, syncState: "error", syncError: message } : tab)),
            );
            pushDebugEvent(`sync rejected: ${message}`);
            continue;
          }

          setDbReachable(false);
          pushDebugEvent("sync failed (local only)");
          break;
        }
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncInFlight(false);
      if (deferredSyncFlushRef.current && !dragState.current && dbReachable) {
        deferredSyncFlushRef.current = false;
        if (syncFlushTimer.current) {
          window.clearTimeout(syncFlushTimer.current);
        }
        syncFlushTimer.current = window.setTimeout(() => {
          syncFlushTimer.current = null;
          void flushUnsyncedTabs();
        }, 0);
      }
    }
  }, [dbReachable, localUserId, pushDebugEvent]);

  const scheduleSyncFlush = useCallback((delayMs: number) => {
    if (syncFlushTimer.current) {
      window.clearTimeout(syncFlushTimer.current);
    }

    syncFlushTimer.current = window.setTimeout(() => {
      syncFlushTimer.current = null;
      void flushUnsyncedTabs();
    }, delayMs);
  }, [flushUnsyncedTabs]);

  useEffect(() => {
    if (!tutorialStep) return;
    setShowAddTool(true);
  }, [tutorialStep]);

  useEffect(() => {
    if (!canEdit) {
      setShowAddTool(false);
    }
  }, [activeTabId, canEdit]);

  useEffect(() => {
    if (shareFeedbackTimerRef.current) {
      window.clearTimeout(shareFeedbackTimerRef.current);
      shareFeedbackTimerRef.current = null;
    }
    setShareStatus("idle");
  }, [activeTabId]);

  useEffect(() => () => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
    }
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
    }
    if (shareFeedbackTimerRef.current) {
      window.clearTimeout(shareFeedbackTimerRef.current);
    }
    if (syncFlushTimer.current) {
      window.clearTimeout(syncFlushTimer.current);
    }
    if (localWriteTimer.current) {
      window.clearTimeout(localWriteTimer.current);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setDbReachable(true);
      scheduleSyncFlush(0);
    };
    const handleOffline = () => setDbReachable(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scheduleSyncFlush]);

  useEffect(() => {
    ACTION_ZONE_KINDS.forEach((kind) => {
      paintActionZoneKind(kind, actionZoneProximityRefs.current[kind]);
    });
  }, [paintActionZoneKind]);

  useEffect(() => {
    if (!sharedTabId || sharedTabUrlCleanedRef.current) return;
    if (activeTabId !== sharedTabId) return;
    if (!visibleTabs(tabs).some((tab) => tab.id === sharedTabId)) return;

    removeSharedTabFromUrl();
    sharedTabUrlCleanedRef.current = true;
  }, [activeTabId, sharedTabId, tabs]);

  useEffect(() => {
    let cancelled = false;

    const loadTabs = async () => {
      try {
        const focusTabId = sharedTabId ?? loadActiveTabId();
        const cachedTabs = orderTabs(withStaticNowTab((await readCachedTabs(focusTabId)).map(normalizeTab), STATIC_NOW_TAB));
        if (!cancelled && cachedTabs.length > 0) {
          tabsRef.current = cachedTabs;
          setTabs(cachedTabs);
          setActiveTabId((current) => {
            const visible = visibleTabs(cachedTabs);
            if (sharedTabId && visible.some((tab) => tab.id === sharedTabId)) return sharedTabId;
            const cachedActiveTabId = loadActiveTabId(visibleTabs(cachedTabs));
            if (cachedActiveTabId) return cachedActiveTabId;
            return visible.some((tab) => tab.id === current) ? current : visible[0]?.id ?? cachedTabs[0].id;
          });
          pushDebugEvent("cache load ok");
        }
      } catch {
        if (!cancelled) pushDebugEvent("cache load failed");
      } finally {
        if (!cancelled) setCacheReady(true);
      }

      try {
        const { tabs: remoteTabs } = await fetchTabs(localUserId);
        if (cancelled) return;
        setDbReachable(true);
        const remoteNonStaticTabs = remoteTabs.map(normalizeTab).filter((tab) => !isStaticNowTab(tab));
        const currentNonStaticTabs = tabsRef.current.filter((tab) => !isStaticNowTab(tab));
        const normalized = orderTabs(withStaticNowTab(mergeRemoteTabSummaries(remoteNonStaticTabs, currentNonStaticTabs), STATIC_NOW_TAB));
        tabsRef.current = normalized;
        setTabs(normalized);
        setActiveTabId((current) => {
          const visible = visibleTabs(normalized);
          if (sharedTabId && visible.some((tab) => tab.id === sharedTabId)) return sharedTabId;
          const savedTabId = loadActiveTabId(visible);
          if (savedTabId) return savedTabId;
          return visible.some((tab) => tab.id === current) ? current : visible[0]?.id ?? normalized[0]?.id ?? seedTabs[0].id;
        });
        pushDebugEvent("fetch ok");
      } catch {
        if (!cancelled) {
          setDbReachable(false);
          pushDebugEvent("fetch failed (using local)");
        }
      } finally {
        initialized.current = true;
      }
    };

    void loadTabs();

    return () => {
      cancelled = true;
    };
  }, [localUserId, pushDebugEvent, sharedTabId]);

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    if (!tab || tab.hasLayout !== false) return;

    let cancelled = false;
    const loadLayout = async () => {
      try {
        const cachedLayout = await readCachedLayout(tab.id);
        if (cancelled) return;
        const cachedTab = applyCachedLayout(tab, cachedLayout);
        if (cachedTab.hasLayout !== false) {
          setTabs((current) =>
            orderTabs(current.map((item) => (item.id === cachedTab.id ? normalizeTab(cachedTab) : item))),
          );
          pushDebugEvent("tab layout loaded from cache");
          return;
        }
      } catch {
        if (!cancelled) pushDebugEvent("tab layout cache miss");
      }

      if (isUnsyncedTab(tab)) {
        if (tab.syncState === "error" && tab.syncError === MISSING_LOCAL_LAYOUT_MESSAGE) {
          return;
        }
        setTabs((current) =>
          current.map((item) => (item.id === tab.id ? { ...item, syncState: "error", syncError: MISSING_LOCAL_LAYOUT_MESSAGE } : item)),
        );
        pushDebugEvent("local draft layout unavailable");
        return;
      }

      try {
        const { tab: loaded } = await fetchTab(tab.id, localUserId);
        if (cancelled) return;
        setTabs((current) =>
          orderTabs(current.map((item) => (item.id === loaded.id ? normalizeTab({ ...loaded, hasLayout: true }) : item))),
        );
        pushDebugEvent("tab layout loaded");
      } catch {
        if (cancelled) return;
        pushDebugEvent("tab layout load failed");
      }
    };

    void loadLayout();

    return () => {
      cancelled = true;
    };
  }, [activeTabId, localUserId, pushDebugEvent, tabs]);

  useEffect(() => {
    tabsRef.current = tabs;
    localAuthorTabCountRef.current = countClientAuthorTabs(tabs, localUserId);
  }, [localUserId, tabs]);

  useEffect(() => {
    if (!visibleTabs(tabsRef.current).some((tab) => tab.id === activeTabId)) return;
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    localStorage.setItem(
      CONTROLS_STORAGE_KEY,
      JSON.stringify({ gridDark, snapMode, dimsMode, showInfra, showMezz })
    );
  }, [gridDark, snapMode, dimsMode, showInfra, showMezz]);

  const queueCacheSnapshotWrite = useCallback((snapshot: LayoutTab[]) => {
    queuedCacheSnapshotRef.current = snapshot;
    if (cacheWriteInFlightRef.current) return;

    const writeNext = () => {
      const nextSnapshot = queuedCacheSnapshotRef.current;
      if (!nextSnapshot) return;

      queuedCacheSnapshotRef.current = null;
      cacheWriteInFlightRef.current = true;
      void writeTabCacheSnapshot(nextSnapshot)
        .then(() => {
          pushDebugEvent("cache write ok");
        })
        .catch(() => {
          pushDebugEvent("cache write failed");
        })
        .finally(() => {
          cacheWriteInFlightRef.current = false;
          localWriteTimer.current = null;
          if (queuedCacheSnapshotRef.current) {
            writeNext();
          }
        });
    };

    writeNext();
  }, [pushDebugEvent]);

  useEffect(() => {
    if (!cacheReady) return;

    if (localWriteTimer.current) {
      window.clearTimeout(localWriteTimer.current);
    }
    localWriteTimer.current = window.setTimeout(() => {
      queueCacheSnapshotWrite(orderTabs(tabsRef.current.filter((tab) => !isStaticNowTab(tab)).map(normalizeTab)));
    }, LOCAL_WRITE_DELAY_MS);

    if (!initialized.current || syncInFlightRef.current || !dbReachable) return;
    if (hasFlushableTabs(tabs)) {
      scheduleSyncFlush(saveDelayMs.current);
      saveDelayMs.current = DEFAULT_SAVE_DELAY_MS;
    }
  }, [cacheReady, dbReachable, queueCacheSnapshotWrite, scheduleSyncFlush, tabs]);

  useEffect(() => {
    activeTabButtonRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeTabId, tabs.length]);

  const startToolDrag = (event: ReactPointerEvent<SVGGElement>, tool: ToolShape) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) {
      triggerClonePrompt();
      return;
    }

    setSelectedToolId(tool.id);
    if (event.button !== 0) {
      return;
    }

    const matrix = svgRef.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    const local = svgPointFromMatrix(matrix, event.clientX, event.clientY);
    if (!local) return;
    const actionZoneCenters = ACTION_ZONE_KINDS.reduce((centers, kind) => {
      const rect = actionZoneRefs.current[kind]?.getBoundingClientRect();
      centers[kind] = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null;
      return centers;
    }, {} as Record<ActionZoneKind, ActionZoneCenter>);
    svgRef.current?.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      tabId: activeTabId,
      toolId: tool.id,
      offsetX: local.x - tool.x,
      offsetY: local.y - tool.y,
      originalX: tool.x,
      originalY: tool.y,
      latestX: tool.x,
      latestY: tool.y,
      width: tool.width,
      height: tool.height,
      rotation: tool.rotation,
      element: event.currentTarget,
      inverseScreenMatrix: matrix,
      actionZoneCenters,
      activeActionZone: null,
    };
    setDraggingToolId(tool.id);
  };

  const startToolRotate = (event: ReactPointerEvent<SVGGElement>, tool: ToolShape) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) {
      triggerClonePrompt();
      return;
    }
    if (event.button !== 0) return;

    const matrix = svgRef.current?.getScreenCTM()?.inverse();
    const element = event.currentTarget.closest(".tool-node") as SVGGElement | null;
    if (!matrix || !element) return;

    const local = svgPointFromMatrix(matrix, event.clientX, event.clientY);
    const centerX = tool.x + tool.width / 2;
    const centerY = tool.y + tool.height / 2;
    svgRef.current?.setPointerCapture(event.pointerId);
    rotateDragState.current = {
      pointerId: event.pointerId,
      tabId: activeTabId,
      toolId: tool.id,
      originalRotation: normalizeRotation(tool.rotation),
      latestRotation: normalizeRotation(tool.rotation),
      startAngle: angleDegreesFromCenter(centerX, centerY, local.x, local.y),
      centerX,
      centerY,
      x: tool.x,
      y: tool.y,
      width: tool.width,
      height: tool.height,
      element,
      inverseScreenMatrix: matrix,
    };
    setSelectedToolId(tool.id);
  };

  const moveToolDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rotating = rotateDragState.current;
    if (rotating && rotating.pointerId === event.pointerId) {
      const local = svgPointFromMatrix(rotating.inverseScreenMatrix, event.clientX, event.clientY);
      const nextAngle = angleDegreesFromCenter(rotating.centerX, rotating.centerY, local.x, local.y);
      const nextRotation = snapRotation(rotating.originalRotation + nextAngle - rotating.startAngle);
      rotating.latestRotation = nextRotation;
      rotating.element.setAttribute(
        "transform",
        toolTransform({
          x: rotating.x,
          y: rotating.y,
          width: rotating.width,
          height: rotating.height,
          rotation: nextRotation,
        }),
      );
      return;
    }

    const current = dragState.current;
    if (current && current.pointerId === event.pointerId) {
      const local = svgPointFromMatrix(current.inverseScreenMatrix, event.clientX, event.clientY);
      const nextX = local.x - current.offsetX;
      const nextY = local.y - current.offsetY;
      const next = snapToolPosition(current, nextX, nextY, snapMode);
      current.latestX = next.x;
      current.latestY = next.y;
      current.element.setAttribute(
        "transform",
        toolTransform({
          x: next.x,
          y: next.y,
          width: current.width,
          height: current.height,
          rotation: current.rotation,
        }),
      );

      const proximities = ACTION_ZONE_KINDS.reduce((next, kind) => {
        next[kind] = actionZoneProximity(event.clientX, event.clientY, current.actionZoneCenters[kind]);
        return next;
      }, {} as Record<ActionZoneKind, ReturnType<typeof actionZoneProximity>>);
      current.activeActionZone = ACTION_ZONE_DROP_PRIORITY.find((kind) => proximities[kind].isOver) ?? null;
      ACTION_ZONE_KINDS.forEach((kind) => {
        paintActionZoneKind(kind, proximities[kind].level);
      });
      return;
    }

    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = (event.clientX - pan.startClientX) * (pan.startViewBox.width / pan.svgWidth);
    const dy = (event.clientY - pan.startClientY) * (pan.startViewBox.height / pan.svgHeight);
    setViewBox(
      clampViewBox({
        ...pan.startViewBox,
        minX: pan.startViewBox.minX - dx,
        minY: pan.startViewBox.minY - dy,
      }),
    );
  };

  const endToolDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rotating = rotateDragState.current;
    if (rotating && rotating.pointerId === event.pointerId) {
      rotateDragState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      if (Math.abs(rotating.latestRotation - rotating.originalRotation) > 0.01) {
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (tab.id !== rotating.tabId) return tab;
            return {
              ...tab,
              layout: {
                ...tab.layout,
                tools: tab.layout.tools.map((tool) =>
                  tool.id === rotating.toolId
                    ? {
                      ...tool,
                      rotation: rotating.latestRotation,
                    }
                    : tool,
                ),
              },
            };
          }),
        );
        markTabDirty(rotating.tabId, "Rotated tool");
      }
    }

    const current = dragState.current;
    if (current && current.pointerId === event.pointerId) {
      dragState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      setDraggingToolId(null);

      if (current.activeActionZone === "copy") {
        const sourceTab = tabsRef.current.find((tab) => tab.id === current.tabId) ?? activeTab;
        const sourceTool = sourceTab.layout.tools.find((tool) => tool.id === current.toolId);
        if (!sourceTool) return;
        current.element.setAttribute(
          "transform",
          toolTransform({
            x: current.originalX,
            y: current.originalY,
            width: current.width,
            height: current.height,
            rotation: current.rotation,
          }),
        );
        const nextId = makeShortId("tool", sourceTab.layout.tools.map((tool) => tool.id));
        const nextPosition = clampToolPosition(
          current,
          viewBox.minX + viewBox.width / 2 - current.width / 2,
          viewBox.minY + viewBox.height / 2 - current.height / 2,
        );
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (tab.id !== current.tabId) return tab;
            return {
              ...tab,
              layout: {
                ...tab.layout,
                tools: [
                  ...tab.layout.tools,
                  {
                    ...sourceTool,
                    ...nextPosition,
                    id: nextId,
                  },
                ],
              },
            };
          }),
        );
        setSelectedToolId(nextId);
        markTabDirty(current.tabId, ACTION_ZONES.copy.dirtyMessage);
      } else if (current.activeActionZone === "delete") {
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (tab.id !== current.tabId) return tab;
            return {
              ...tab,
              layout: {
                ...tab.layout,
                tools: tab.layout.tools.filter((tool) => tool.id !== current.toolId),
              },
            };
          })
        );
        markTabDirty(current.tabId, ACTION_ZONES.delete.dirtyMessage);
      } else {
        const moved = Math.abs(current.latestX - current.originalX) > 0.01 || Math.abs(current.latestY - current.originalY) > 0.01;
        if (moved) {
          setTabs((currentTabs) =>
            currentTabs.map((tab) => {
              if (tab.id !== current.tabId) return tab;
              return {
                ...tab,
                layout: {
                  ...tab.layout,
                  tools: tab.layout.tools.map((tool) =>
                    tool.id === current.toolId
                      ? {
                        ...tool,
                        x: current.latestX,
                        y: current.latestY,
                      }
                      : tool,
                  ),
                },
              };
            }),
          );
          markTabDirty(current.tabId, "Moved tool");
        }
      }
      if (deferredSyncFlushRef.current && dbReachable) {
        deferredSyncFlushRef.current = false;
        scheduleSyncFlush(0);
      }
      resetActionZones();
    }

    const pan = panState.current;
    if (pan && pan.pointerId === event.pointerId) {
      panState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      setIsPanning(false);
    }
  };

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    const isToolTarget = event.target instanceof Element && Boolean(event.target.closest(".tool-node"));
    if (isToolTarget) {
      if (shouldPromptForClone) triggerClonePrompt();
      return;
    }
    setSelectedToolId(null);
    if (shouldPromptForClone) {
      triggerClonePrompt();
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    panState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewBox: viewBox,
      svgWidth: rect.width,
      svgHeight: rect.height,
    };
    setIsPanning(true);
  };

  const zoomFloorplan = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (shouldPromptForClone) {
      triggerClonePrompt();
    }
    const local = getSvgPoint(event.clientX, event.clientY);
    if (!local) return;

    const zoomFactor = Math.exp(event.deltaY * 0.0012);
    setViewBox((current) => {
      const nextWidth = clamp(current.width * zoomFactor, MIN_ZOOM_WIDTH, FULL_VIEWBOX.width);
      const nextHeight = clamp(current.height * zoomFactor, MIN_ZOOM_HEIGHT, FULL_VIEWBOX.height);
      const anchorX = (local.x - current.minX) / current.width;
      const anchorY = (local.y - current.minY) / current.height;

      return clampViewBox({
        minX: local.x - anchorX * nextWidth,
        minY: local.y - anchorY * nextHeight,
        width: nextWidth,
        height: nextHeight,
      });
    });
  };

  const debugLines = useMemo(() => {
    const selected = selectedTool
      ? `${selectedTool.name} ${inchesToFeetInches(selectedTool.width)}x${inchesToFeetInches(selectedTool.height)}`
      : "none";
    const activeTabBytes = estimateJsonBytes(normalizeTab(activeTab));
    const totalTools = displayedTabs.reduce((count, tab) => count + tab.layout.tools.length, 0);
    const totalBytes = estimateJsonBytes(displayedTabs.map(normalizeTab));

    return [
      `selected: ${selected}`,
      `tab tools: ${activeTab.layout.tools.length} / ${VALIDATION_LIMITS.toolsPerTab}`,
      `tab json: ${formatKiB(activeTabBytes)} / ${formatKiB(VALIDATION_LIMITS.requestBytes)}`,
      `page tabs: ${displayedTabs.length}`,
      `page tools: ${totalTools}`,
      `page json: ${formatKiB(totalBytes)}`,
      draggingToolId ? "dragging" : "ready",
    ];
  }, [activeTab, displayedTabs, draggingToolId, selectedTool]);

  const handleCloneTab = async (source: LayoutTab) => {
    if (tabCreationLimitMessage || isClientAuthorTabLimitReached(tabsRef.current, localUserId)) {
      return;
    }

    let sourceTab = source;
    if (sourceTab.hasLayout === false) {
      try {
        const cachedTab = applyCachedLayout(sourceTab, await readCachedLayout(sourceTab.id));
        if (cachedTab.hasLayout !== false) {
          sourceTab = normalizeTab(cachedTab);
          setTabs((current) => orderTabs(current.map((item) => (item.id === sourceTab.id ? sourceTab : item))));
          pushDebugEvent("clone source loaded from cache");
        }
      } catch {
        pushDebugEvent("clone source cache miss");
      }
    }

    if (sourceTab.hasLayout === false) {
      try {
        const { tab } = await fetchTab(sourceTab.id, localUserId);
        sourceTab = normalizeTab({ ...tab, hasLayout: true });
        setTabs((current) => orderTabs(current.map((item) => (item.id === sourceTab.id ? sourceTab : item))));
      } catch {
        pushDebugEvent("clone source load failed");
        return;
      }
    }

    if (localAuthorTabCountRef.current >= TAB_LIMITS.perAuthor) {
      return;
    }

    const dirtyAt = new Date().toISOString();
    const clone = {
      ...cloneLayoutTab(sourceTab, tabsRef.current.map((tab) => tab.id)),
      authorId: localUserId,
      hasLayout: true,
      syncState: "draft-clone" as const,
      dirtyAt,
      syncError: undefined,
    };
    localAuthorTabCountRef.current += 1;
    setTabs((current) => orderTabs([...current, clone]));
    setActiveTabId(clone.id);
    setSelectedToolId(null);
    pushDebugEvent("clone draft created");

    if (!localStorage.getItem("pstbg3shwavep-tutorial-seen")) {
      setTutorialStep("overview");
      localStorage.setItem("pstbg3shwavep-tutorial-seen", "true");
    }
  };

  const renameTab = (tabId: string, nextName: string) => {
    const trimmed = normalizeTabName(nextName, "");
    if (!trimmed || trimmed === NOW_TAB_NAME || tabs.some((tab) => tab.id === tabId && isStaticNowTab(tab))) {
      setRenamingTabId(null);
      return;
    }
    if (trimmed === tabs.find((tab) => tab.id === tabId)?.name) {
      setRenamingTabId(null);
      setRenameDraft("");
      return;
    }

    setTabs((current) =>
      current.map((tab) => {
        if (tab.id === tabId) {
          return {
            ...tab,
            name: trimmed,
          };
        }

        return tab;
      }),
    );
    setRenamingTabId(null);
    setRenameDraft("");
    markTabDirty(tabId, "Renamed tab", DEFAULT_SAVE_DELAY_MS, { flushDraftClone: false });
  };

  const deleteClonedTab = async (tab: LayoutTab) => {
    if (isStaticNowTab(tab)) return;
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setConfirmingDeleteTabId((current) => (current === tab.id ? null : current));

    const fallbackTab = displayedTabs.find((item) => item.id !== tab.id) ?? seedTabs.map(normalizeTab)[0];

    setActiveTabId((current) => (current === tab.id ? fallbackTab.id : current));
    setSelectedToolId(null);

    if (tab.syncState === "local-only" || tab.syncState === "draft-clone") {
      setTabs((current) => current.filter((item) => item.id !== tab.id));
      pushDebugEvent("local tab deleted");
      return;
    }

    const dirtyAt = new Date().toISOString();
    setTabs((current) =>
      current.map((item) =>
        item.id === tab.id
          ? { ...item, syncState: "delete-pending", dirtyAt, syncError: undefined }
          : item,
      ),
    );
    saveDelayMs.current = 0;
    pushDebugEvent("delete queued");
  };

  const cancelAnimatedDelete = () => {
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setConfirmingDeleteTabId(null);
  };

  const startAnimatedDelete = (tab: LayoutTab) => {
    if (isStaticNowTab(tab) || confirmingDeleteTabId === tab.id) return;
    if (deleteConfirmTimerRef.current) {
      window.clearTimeout(deleteConfirmTimerRef.current);
    }

    setRenamingTabId((current) => (current === tab.id ? null : current));
    setActiveTabId(tab.id);
    setSelectedToolId(null);
    setConfirmingDeleteTabId(tab.id);
    deleteConfirmTimerRef.current = window.setTimeout(() => {
      deleteConfirmTimerRef.current = null;
      void deleteClonedTab(tab);
    }, TAB_DELETE_CONFIRM_MS);
  };

  const holdAnimatedDelete = (event: ReactPointerEvent<HTMLButtonElement>, tab: LayoutTab) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startAnimatedDelete(tab);
  };

  const clearLocalDraft = () => {
    localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    localStorage.removeItem(CONTROLS_STORAGE_KEY);
    localStorage.removeItem("pstbg3shwavep-tutorial-seen");
    void clearTabCache().catch(() => {
      pushDebugEvent("cache clear failed");
    });
    const freshTabs = orderTabs(withStaticNowTab(seedTabs.map(normalizeTab), STATIC_NOW_TAB));
    setTabs(freshTabs);
    setActiveTabId(freshTabs[0].id);
    setSelectedToolId(null);
    pushDebugEvent("local draft cleared");
  };

  const serializeCurrentSvg = () => {
    const svg = svgRef.current;
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:inkscape", "http://www.inkscape.org/namespaces/inkscape");
    clone.setAttribute("viewBox", `${FULL_VIEWBOX.minX} ${FULL_VIEWBOX.minY} ${FULL_VIEWBOX.width} ${FULL_VIEWBOX.height}`);
    clone.setAttribute("width", String(FULL_VIEWBOX.width));
    clone.setAttribute("height", String(FULL_VIEWBOX.height));

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .infra-layer{display:${showInfra ? "block" : "none"}}
      .mezzanine-layer{display:${showMezz ? "block" : "none"}}
    `;
    clone.insertBefore(style, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  };

  const exportSvg = () => {
    const markup = serializeCurrentSvg();
    if (!markup) return;
    downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), filenameFor(activeTab.name, "svg"));
    pushDebugEvent("export svg");
  };

  const exportPng = () => {
    const markup = serializeCurrentSvg();
    if (!markup) return;
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = FULL_VIEWBOX.width;
      canvas.height = FULL_VIEWBOX.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#fbfaf6";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) downloadBlob(pngBlob, filenameFor(activeTab.name, "png"));
        URL.revokeObjectURL(url);
      }, "image/png");
      pushDebugEvent("export png");
    };
    image.src = url;
  };

  const shareActiveTab = async () => {
    if (!activeTab || !canShareActiveTab) return;

    try {
      await copyTextToClipboard(buildTabShareUrl(activeTab.id));
      flashShareStatus("copied");
      pushDebugEvent("share link copied");
    } catch {
      flashShareStatus("failed");
      pushDebugEvent("share link failed");
    }
  };

  const handleAddToolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = normalizeToolName(addToolForm.name);
    const w = parseFeetInches(addToolForm.x);
    const h = parseFeetInches(addToolForm.y);

    const errors = {
      name: !name,
      x: !isValidToolSize(w),
      y: !isValidToolSize(h),
    };
    setAddToolErrors(errors);
    if (Object.values(errors).some(v => v)) return;

    const cx = viewBox.minX + viewBox.width / 2 - w / 2;
    const cy = viewBox.minY + viewBox.height / 2 - h / 2;

    const newTool: Omit<ToolShape, "id"> = {
      name,
      x: cx,
      y: cy,
      width: w,
      height: h,
      rotation: 0,
      color: ACTIVITY_COLORS[addToolForm.activity] ?? ACTIVITY_COLORS.undefined,
      activity: addToolForm.activity,
      hazards: addToolForm.hazards.length > 0 ? addToolForm.hazards : undefined,
    };

    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        return {
          ...tab,
          layout: {
            ...tab.layout,
            tools: [
              ...tab.layout.tools,
              {
                ...newTool,
                id: makeShortId("tool", tab.layout.tools.map((tool) => tool.id)),
              },
            ],
          },
        };
      })
    );
    markTabDirty(activeTabId, "saving in background");
    setShowAddTool(false);
    setAddToolForm({ name: "", x: "", y: "", activity: "undefined", hazards: [] });
    setAddToolErrors({});
  };

  return (
    <main className="app-shell">
      <section
        className="workspace"
        aria-label="Protospace Space Board The Board Game 3, Space Hard With A Vengeance Expansion Pack"
        tabIndex={0}
      >
        {debugPanel.isVisible && (
          <DebugPanel
            debugLines={debugLines}
            events={debugPanel.events}
            logRef={debugPanel.logRef}
            onClearLocalDraft={clearLocalDraft}
            onClose={() => debugPanel.setIsVisible(false)}
          />
        )}
        {!debugPanel.isVisible && debugPanel.showDevLauncher && (
          <button
            type="button"
            className="debug-launcher"
            onClick={() => debugPanel.setIsVisible(true)}
            title="Open debug panel"
            aria-label="Open debug panel"
          >
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path className="debug-launcher-helmet" d="M9 28c2-13 12-21 23-21s21 8 23 21l-4 20c-4 5-10 8-19 8s-15-3-19-8L9 28Z" />
              <path className="debug-launcher-face" d="M17 31c3-5 8-8 15-8s12 3 15 8l-3 14c-3 4-7 6-12 6s-9-2-12-6l-3-14Z" />
              <path className="debug-launcher-brow" d="M19 32l10 3M45 32l-10 3" />
              <path className="debug-launcher-mouth" d="M25 44h14" />
              <circle cx="24" cy="36" r="3" />
              <circle cx="40" cy="36" r="3" />
            </svg>
          </button>
        )}

        <div className="bottom-controls-wrap">
          <div className="floorplan-controls-stack">
            {(!activeTabIsStaticNow || disketteSyncError) && (
              <DisketteStatusIcon
                status={disketteStatus}
                label={disketteLabel}
                offline={!dbReachable}
                syncError={disketteSyncError}
                persistentTooltip={Boolean(disketteSyncError)}
              />
            )}
            <div className="floorplan-controls" aria-label="Floorplan controls">
              <button
                type="button"
                className={isTutorialActive ? "tutorial-highlight" : ""}
                onClick={() => {
                  if (!canEdit) return;
                  setShowAddTool((current) => (isTutorialActive ? true : !current));
                }}
                disabled={!canEdit}
              >
                {showAddTool ? "− add" : "+ add"}
              </button>
              <label>
                <input type="checkbox" checked={gridDark} onChange={(event) => setGridDark(event.target.checked)} />
                grid
              </label>
              <label className={`snap-control ${snapMode}`} data-tooltip={snapMode === "off" ? undefined : snapModeLabel(snapMode)}>
                <input
                  type="checkbox"
                  className="snap-checkbox"
                  checked={snapMode !== "off"}
                  aria-label={`snap: ${snapModeLabel(snapMode)}`}
                  aria-checked={snapMode === "center" ? "mixed" : snapMode !== "off"}
                  onChange={() => setSnapMode((current) => nextSnapMode(current))}
                />
                snap
              </label>
              <label className={`dims-control ${dimsMode}`}>
                <input
                  type="checkbox"
                  className="dims-checkbox"
                  checked={dimsMode !== "off"}
                  aria-label={`dims: ${dimsModeLabel(dimsMode)}`}
                  aria-checked={dimsMode === "all" ? "mixed" : dimsMode !== "off"}
                  onChange={() => setDimsMode((current) => nextDimsMode(current))}
                />
                dims
              </label>
              <label>
                <input type="checkbox" checked={showMezz} onChange={(event) => setShowMezz(event.target.checked)} />
                mezz
              </label>
              <label>
                <input type="checkbox" checked={showInfra} onChange={(event) => setShowInfra(event.target.checked)} />
                infra
              </label>
              <button type="button" data-tooltip="SVG" onClick={exportSvg}>export</button>
              <button type="button" data-tooltip="PNG" onClick={exportPng}>photo</button>
              <button
                type="button"
                data-tooltip={shareTooltip}
                onClick={shareActiveTab}
                disabled={!canShareActiveTab}
                aria-label={canShareActiveTab ? `Copy link to ${activeTab.name}` : "Share link unavailable until this tab syncs"}
              >
                {shareStatus === "copied" ? "copied" : shareStatus === "failed" ? "failed" : "share"}
              </button>
            </div>
          </div>
          {showAddTool && canEdit && (
            <form className={`add-tool-form ${isTutorialActive ? "tutorial-highlight" : ""}`} onSubmit={handleAddToolSubmit} noValidate>
              <label>
                {addToolErrors.name && <span className="error-bubble">req'd</span>}
                <input
                  type="text"
                  autoFocus
                  maxLength={MAX_TOOL_NAME_CHARS}
                  value={addToolForm.name}
                  onChange={(e) => setAddToolForm({ ...addToolForm, name: e.target.value.slice(0, MAX_TOOL_NAME_CHARS) })}
                />
              </label>
              <div className="row">
                <label>
                  {addToolErrors.x && <span className="error-bubble">max 120'</span>}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addToolForm.x}
                    onChange={(e) => setAddToolForm({ ...addToolForm, x: e.target.value })}
                    onBlur={() => {
                      const valStr = addToolForm.x.trim();
                      if (valStr && /^\d+(\.\d+)?$/.test(valStr)) {
                        const val = parseFloat(valStr);
                        const suffix = val <= 12 ? "'" : '"';
                        setAddToolForm({ ...addToolForm, x: `${val}${suffix}` });
                      }
                    }}
                    placeholder="x'x&quot;"
                  />
                </label>
                <label>
                  {addToolErrors.y && <span className="error-bubble">max 120'</span>}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addToolForm.y}
                    onChange={(e) => setAddToolForm({ ...addToolForm, y: e.target.value })}
                    onBlur={() => {
                      const valStr = addToolForm.y.trim();
                      if (valStr && /^\d+(\.\d+)?$/.test(valStr)) {
                        const val = parseFloat(valStr);
                        const suffix = val <= 12 ? "'" : '"';
                        setAddToolForm({ ...addToolForm, y: `${val}${suffix}` });
                      }
                    }}
                    placeholder="y'y&quot;"
                  />
                </label>
              </div>
              <label>
                <select value={addToolForm.activity} onChange={(e) => setAddToolForm({ ...addToolForm, activity: e.target.value as any })}>
                  <option value="undefined">activity</option>
                  <option value="automotive">automotive</option>
                  <option value="electronics">electronics</option>
                  <option value="glass/clay">glass/clay</option>
                  <option value="lasers">lasers</option>
                  <option value="media/vinyl/art">media/vinyl/art</option>
                  <option value="metal">metal</option>
                  <option value="plastics">plastics</option>
                  <option value="social">social</option>
                  <option value="software/it">software/it</option>
                  <option value="storage">storage</option>
                  <option value="textiles/leather">textiles/leather</option>
                  <option value="training">training</option>
                  <option value="wood">wood</option>
                  <option disabled>──────</option>
                  <option value="red">red</option>
                  <option value="green">green</option>
                  <option value="blue">blue</option>
                </select>
              </label>
              <div className="hazards">
                {["dust", "noise", "dirt", "wet", "fire", "eyes"].map((hz) => (
                  <label key={hz}>
                    <input
                      type="checkbox"
                      checked={addToolForm.hazards.includes(hz as any)}
                      onChange={(e) => {
                        const hzrds = new Set(addToolForm.hazards);
                        if (e.target.checked) hzrds.add(hz as any);
                        else hzrds.delete(hz as any);
                        setAddToolForm({ ...addToolForm, hazards: Array.from(hzrds) });
                      }}
                    />
                    {hz}
                  </label>
                ))}
              </div>
              <button type="submit">spawn object</button>
            </form>
          )}
        </div>

        <svg
          ref={svgRef}
          className={[
            "floorplan",
            isPanning ? "panning" : "",
            isTutorialActive ? "tutorial-zooming" : "",
            gridDark ? "grid-dark" : "",
            showInfra ? "show-infra" : "",
            showMezz ? "show-mezz" : "",
          ].filter(Boolean).join(" ")}
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label="Building geometry with draggable tool shapes"
          onWheel={zoomFloorplan}
          onPointerDown={startPan}
          onPointerMove={moveToolDrag}
          onPointerUp={endToolDrag}
          onPointerCancel={endToolDrag}
          onDragStart={(event) => event.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#202427" strokeOpacity={gridDark ? 0.1 : 0.08} strokeWidth={0.8} />
            </pattern>
            <pattern id="stage-grid" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#202427" strokeOpacity={0.36} strokeWidth={1.2} />
            </pattern>
          </defs>

          <g id="layer-background" className="background-layer" aria-label="Background layer">
            <rect
              className="viewport-bg"
              x={STAGE_BOUNDS.minX}
              y={STAGE_BOUNDS.minY}
              width={STAGE_BOUNDS.maxX - STAGE_BOUNDS.minX}
              height={STAGE_BOUNDS.maxY - STAGE_BOUNDS.minY}
              fill="#fbfaf6"
            />
          </g>


          <g
            id="layer-building-geometry-source"
            className="base-svg-layer"
            aria-label="Shared building geometry"
            dangerouslySetInnerHTML={{ __html: activeTabIsStaticNow ? NOW_MARKUP : NOW_GEOMETRY_MARKUP }}
          />

          <g id="layer-grid-overlay" className="grid-layer" aria-label="Grid overlay layer">
            {gridDark && (
              <rect
                x={STAGE_BOUNDS.minX}
                y={STAGE_BOUNDS.minY}
                width={STAGE_BOUNDS.maxX - STAGE_BOUNDS.minX}
                height={STAGE_BOUNDS.maxY - STAGE_BOUNDS.minY}
                fill="url(#stage-grid)"
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>

          <g id="layer-tools" {...{ "inkscape:label": "tools", "inkscape:groupmode": "layer" }}>
            {(activeTabIsStaticNow ? [] : activeTab.layout.tools).map((tool) => {
              const selected = tool.id === selectedToolId;
              const showToolDims = dimsMode === "all" || (dimsMode === "selected" && selected && canEdit);
              const showToolOverlay = showToolDims || (selected && canEdit);
              return (
                <g
                  key={tool.id}
                  id={tool.id}
                  {...{ "inkscape:label": tool.name }}
                  className={[
                    "tool-node",
                    selected ? "selected" : "",
                    draggingToolId === tool.id ? "dragging" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ color: tool.color }}
                  data-tool-id={tool.id}
                  data-tool-activity={tool.activity}
                  data-tool-hazards={tool.hazards?.join(",")}
                  data-tool-color={tool.color}
                  transform={toolTransform(tool)}
                  onPointerDown={(event) => startToolDrag(event, tool)}
                >
                  <rect width={tool.width} height={tool.height} rx={0} fill={tool.color} fillOpacity={0.12} stroke={tool.color} strokeWidth={1.5} />
                  <text
                    x={tool.width / 2}
                    y={tool.height / 2}
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fill="#202427"
                    fontSize={12}
                    fontWeight={800}
                    fontFamily="sans-serif"
                    transform={tool.height > tool.width ? `rotate(-90, ${tool.width / 2}, ${tool.height / 2})` : undefined}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {tool.name}
                  </text>
                  {tool.hazards && tool.hazards.length > 0 && (
                    <g id={`${tool.id}-hazards`} {...{ "inkscape:label": "hazards" }}>
                      {(() => {
                        let cx = tool.width - 4;
                        return tool.hazards.map((h) => {
                          const hw = h === "dirt" ? 11 : h === "fire" ? 10 : h === "eyes" ? 12 : h === "dust" ? 8 : 6;
                          cx -= hw / 2;
                          const x = cx;
                          cx -= hw / 2 + 4;
                          return (
                            <g key={h} className="hazard-icon" transform={`translate(${x} ${tool.height - 14})`} stroke="none">
                              {h === "dust" && (
                                <g transform="translate(0, 4.2)">
                                  <circle cx="0" cy="0" r="0.8" fill="currentColor" />
                                  <circle cx="-2" cy="3" r="0.8" fill="currentColor" />
                                  <circle cx="2" cy="3" r="0.8" fill="currentColor" />
                                  <circle cx="-4" cy="6" r="0.8" fill="currentColor" />
                                  <circle cx="0" cy="6" r="0.8" fill="currentColor" />
                                  <circle cx="4" cy="6" r="0.8" fill="currentColor" />
                                </g>
                              )}
                              {h === "noise" && <polygon points="-3,8 0,8 3,11 3,1 0,4 -3,4" fill="currentColor" />}
                              {h === "dirt" && (
                                <g transform="translate(0, 6.6) scale(1.1)">
                                  <path d="M0 -4 C 1 -2 3 -2 3 0 C 4 0 5 1 5 2 C 5 3.5 3 4 0 4 C -3 4 -5 3.5 -5 2 C -5 1 -4 0 -3 0 C -3 -2 -1 -2 0 -4 Z" fill="currentColor" />
                                </g>
                              )}
                              {h === "wet" && <path d="M0 2 C0 2 -3 6 -3 8 C-3 9.6 -1.7 11 0 11 C1.7 11 3 9.6 3 8 C3 6 0 2 0 2 Z" fill="currentColor" />}
                              {h === "fire" && (
                                <g transform="translate(-5.7, 0.8) scale(0.52)">
                                  <path d="M5.926 20.574a7.26 7.26 0 0 0 3.039 1.511c.107.035.179-.105.107-.175-2.395-2.285-1.079-4.758-.107-5.873.693-.796 1.68-2.107 1.608-3.865 0-.176.18-.317.322-.211 1.359.703 2.288 2.25 2.538 3.515.394-.386.537-.984.537-1.511 0-.176.214-.317.393-.176 1.287 1.16 3.503 5.097-.072 8.19-.071.071 0 .212.072.177a8.761 8.761 0 0 0 3.003-1.442c5.827-4.5 2.037-12.48-.43-15.116-.321-.317-.893-.106-.893.351-.036.95-.322 2.004-1.072 2.707-.572-2.39-2.478-5.105-5.195-6.441-.357-.176-.786.105-.75.492.07 3.27-2.063 5.352-3.922 8.059-1.645 2.425-2.717 6.89.822 9.808z" fill="currentColor" />
                                </g>
                              )}
                              {h === "eyes" && (
                                <path
                                  d="M-6 7.1 C-4.45 4.8 -2.25 3.7 0 3.7 C2.25 3.7 4.45 4.8 6 7.1 C4.45 9.4 2.25 10.5 0 10.5 C-2.25 10.5 -4.45 9.4 -6 7.1 Z M0 5.7 A1.4 1.4 0 1 0 0 8.5 A1.4 1.4 0 1 0 0 5.7 Z"
                                  fill="currentColor"
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                />
                              )}
                            </g>
                          );
                        });
                      })()}
                    </g>
                  )}
                  {showToolOverlay && (
                    <g className="selected-tool-overlay" aria-label={`Selected controls for ${tool.name}`}>
                      {showToolDims && (
                        <g className="dimension-callouts" aria-hidden="true">
                          <line className="dimension-extension" x1={0} y1={tool.height} x2={0} y2={tool.height + 11} />
                          <line className="dimension-extension" x1={tool.width} y1={tool.height} x2={tool.width} y2={tool.height + 11} />
                          <line className="dimension-line" x1={0} y1={tool.height + 8} x2={tool.width} y2={tool.height + 8} />
                          <path className="dimension-arrow" d={`M7 ${tool.height + 5} L0 ${tool.height + 8} L7 ${tool.height + 11}`} />
                          <path className="dimension-arrow" d={`M${tool.width - 7} ${tool.height + 5} L${tool.width} ${tool.height + 8} L${tool.width - 7} ${tool.height + 11}`} />
                          <text
                            className="dimension-label"
                            x={tool.width / 2}
                            y={tool.height + 18}
                            dominantBaseline="middle"
                            textAnchor="middle"
                          >
                            {inchesToFeetInches(tool.width)}
                          </text>

                          <line className="dimension-extension" x1={tool.width} y1={0} x2={tool.width + 11} y2={0} />
                          <line className="dimension-extension" x1={tool.width} y1={tool.height} x2={tool.width + 11} y2={tool.height} />
                          <line className="dimension-line" x1={tool.width + 8} y1={0} x2={tool.width + 8} y2={tool.height} />
                          <path className="dimension-arrow" d={`M${tool.width + 5} 7 L${tool.width + 8} 0 L${tool.width + 11} 7`} />
                          <path className="dimension-arrow" d={`M${tool.width + 5} ${tool.height - 7} L${tool.width + 8} ${tool.height} L${tool.width + 11} ${tool.height - 7}`} />
                          <text
                            className="dimension-label"
                            x={tool.width + 8}
                            y={tool.height / 2}
                            dominantBaseline="middle"
                            textAnchor="middle"
                            transform={`rotate(-90 ${tool.width + 8} ${tool.height / 2})`}
                          >
                            {inchesToFeetInches(tool.height)}
                          </text>
                        </g>
                      )}

                      {selected && canEdit && (
                        <g
                          className="rotate-handle"
                          transform={`translate(${tool.width} 0)`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Rotate ${tool.name}`}
                          onPointerDown={(event) => startToolRotate(event, tool)}
                        >
                          <circle className="rotate-hit-area" cx={0} cy={0} r={10} />
                          <path d="M3.5 -4.5 v4 h-4" />
                          <path d="M3 2.8 A5 5 0 1 1 1.9 -4.2" />
                        </g>
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {canEdit && (
          <>
            {ACTION_ZONE_KINDS.map((kind) => {
              const zone = ACTION_ZONES[kind];
              return (
                <div
                  key={kind}
                  ref={(element) => setActionZoneElement(kind, element)}
                  className={[
                    "action-zone",
                    zone.className,
                    isTutorialActive ? "tutorial-pulse" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={zone.ariaLabel}
                >
                  <ActionZoneIcon kind={kind} />
                </div>
              );
            })}
          </>
        )}
      </section>

      <nav className="sheet-tabs" aria-label="Layout tabs">
        {displayedTabs.map((tab) => {
          const isNow = isStaticNowTab(tab);
          const isActive = tab.id === activeTabId;
          const isUserTab = tab.canEdit === true || tab.authorId === localUserId;
          const isOwnTab = !isNow && isUserTab;
          const tabClassName = `sheet-tab${isActive ? " active" : ""}`;
          const isConfirmingDelete = confirmingDeleteTabId === tab.id;
          const isRenameStep = isTutorialActive && isActive;
          const isClonePrompted = clonePrompt?.tabId === tab.id;

          return (
            <div
              key={tab.id}
              className={`sheet-tab-wrap${isConfirmingDelete ? " deleting" : ""}`}
            >
              {isOwnTab && (
                <button
                  type="button"
                  className={`rename-tab ${isRenameStep ? "tutorial-highlight flashing always-visible" : ""}`}
                  onClick={() => {
                    setRenamingTabId(tab.id);
                    setRenameDraft(tab.name);
                  }}
                  aria-label={`Rename ${tab.name}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                    <path d="m13 7 4 4" />
                  </svg>
                </button>
              )}
              {isOwnTab && (
                <button
                  type="button"
                  className={`delete-tab always-visible${isConfirmingDelete ? " confirming" : ""}`}
                  onPointerDown={(event) => holdAnimatedDelete(event, tab)}
                  onPointerUp={cancelAnimatedDelete}
                  onPointerCancel={cancelAnimatedDelete}
                  aria-label={`Hold to delete ${tab.name}`}
                >
                  ×
                </button>
              )}
              {canOfferClone && (
                <button
                  key={`clone-${tab.id}-${isClonePrompted ? clonePrompt.run : 0}`}
                  type="button"
                  className={`clone-tab ${isNow || isClonePrompted ? "always-visible" : ""} ${isClonePrompted ? "flashing" : ""}`}
                  onClick={() => handleCloneTab(tab)}
                  aria-label={`Clone ${tab.name}`}
                >
                  <span aria-hidden="true">+</span>
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button
                  ref={tab.id === activeTab.id ? setActiveTabElement : undefined}
                  type="button"
                  className={tabClassName}
                  style={{ visibility: renamingTabId === tab.id ? "hidden" : "visible" }}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    setSelectedToolId(null);
                  }}
                >
                  {tab.name}
                </button>
                {renamingTabId === tab.id && (
                  <input
                    className={`${tabClassName} tab-name-input`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", boxSizing: "border-box" }}
                    value={renameDraft}
                    autoFocus
                    maxLength={MAX_TAB_NAME_CHARS}
                    onChange={(event) => setRenameDraft(event.target.value.slice(0, MAX_TAB_NAME_CHARS))}
                    onBlur={() => renameTab(tab.id, renameDraft)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") renameTab(tab.id, renameDraft);
                      if (event.key === "Escape") { setRenamingTabId(null); setRenameDraft(""); }
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </nav>

      {tutorialStep && (
        <div
          className="tutorial-overlay"
          aria-label="Board tutorial"
          onClick={() => {
            setTutorialStep(null);
            setShowAddTool(false);
          }}
        >
          <div className="tutorial-tip scroll-tip">
            <div className="tutorial-zoom-callout" aria-hidden="true">
              <div className="tutorial-mouse">
                <span />
              </div>
              <div className="tutorial-zoom-rings">
                <span />
                <span />
              </div>
            </div>
            <strong>Scroll</strong>
            <span>zoom the floorplan</span>
          </div>

          <div className="tutorial-tip add-tip">
            <strong>Add tools</strong>
            <span>spawn objects onto the floor</span>
          </div>

          <div className="tutorial-tip drop-tip">
            <strong>Drop here</strong>
            <span>to delete or copy</span>
          </div>

          <div className="tutorial-tip rename-tip">
            <strong>Rename tab</strong>
            <span>label your new space</span>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
