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
import { isStaticNowTab, makeStaticNowTab, NOW_TAB_NAME, withStaticNowTab } from "./staticNow";
import { applyCachedLayout, clearTabCache, readCachedLayout, readCachedTabs, writeTabCacheSnapshot } from "./tabCache";
import { countClientAuthorTabs, isClientAuthorTabLimitReached } from "./tabLimits";
import {
  disketteStatusLabel,
  getDisketteStatus,
  hasFlushableTabs,
  isFlushableTab,
  mergeRemoteTabSummaries,
  stripSyncMetadata,
  visibleTabs,
  withSyncedState,
} from "./tabSync";
import type { LayoutTab, SaveResponse, ToolShape } from "./types";
import { useDebugPanel } from "./useDebugPanel";

const OLD_TABS_STORAGE_KEY = "pstbg3shwavep-tabs";
const ACTIVE_TAB_STORAGE_KEY = "pstbg3shwavep-active-tab";
const CONTROLS_STORAGE_KEY = "pstbg3shwavep-controls";
const LOCAL_WRITE_DELAY_MS = 300;
const DEFAULT_SAVE_DELAY_MS = 5000;
const TUTORIAL_STEP_MS = 5000;
const TUTORIAL_STEPS = ["zoom", "rotate", "delete", "add", "rename"] as const;
const SNAP_MODES = ["off", "top-left", "center"] as const;
const MAX_TAB_NAME_CHARS = VALIDATION_LIMITS.tabNameChars;
const MAX_TOOL_NAME_CHARS = VALIDATION_LIMITS.toolNameChars;
const MAX_TOOL_SIZE_INCHES = VALIDATION_LIMITS.maxSize;
const STATIC_TOOL_SCOPES = new Set<NonNullable<ToolShape["scope"]>>([
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
    return (raw ? JSON.parse(raw) : {}) as { gridDark?: boolean; snapMode?: SnapMode; showInfra?: boolean; showMezz?: boolean };
  } catch {
    return {};
  }
}

const STAGE_PAD = 200;
const GRID_SIZE_INCHES = 12;

type DragState = {
  pointerId: number;
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
  deleteZoneCenter: { x: number; y: number } | null;
  isOverDelete: boolean;
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
type TutorialStep = typeof TUTORIAL_STEPS[number];
type SnapMode = typeof SNAP_MODES[number];

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

function isToolLayer(element: Element) {
  return element.id === "layer-tools"
    || element.getAttribute("inkscape:label") === "tools"
    || element.getAttribute("data-layer") === "tools";
}

function isStaticToolObjectTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  let current: Element | null = target;
  while (current) {
    const parentElement: Element | null = current.parentElement;
    if (parentElement && isToolLayer(parentElement) && current.tagName.toLowerCase() === "g") {
      return true;
    }
    current = parentElement;
  }

  return false;
}

function staticToolLayers(document: Document) {
  return Array.from(document.querySelectorAll("g")).filter(isToolLayer);
}

function readStaticToolScope(value: string | null) {
  if (!value || !STATIC_TOOL_SCOPES.has(value as NonNullable<ToolShape["scope"]>)) return undefined;
  return value as NonNullable<ToolShape["scope"]>;
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
        const scope = readStaticToolScope(group.getAttribute("data-tool-scope"));
        const hazards = readStaticToolHazards(group.getAttribute("data-tool-hazards"));

        return {
          id: group.id,
          assetId: group.getAttribute("data-tool-asset-id") ?? group.id,
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
          ...(scope ? { scope } : {}),
          ...(hazards ? { hazards } : {}),
        };
      }),
  );
}

function stripStaticToolLayers(markup: string) {
  const document = parseSvgDocument(markup);
  if (!document || typeof XMLSerializer === "undefined") return extractSvgBody(markup);

  staticToolLayers(document).forEach((layer) => layer.remove());
  return Array.from(document.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("\n")
    .trim();
}

const NOW_VIEWBOX = parseSvgViewBox(nowSvg);
const NOW_MARKUP = extractSvgBody(nowSvg);
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
  return `${sign}${feet}' ${inches}"`;
}

function formatCloneName(id: string) {
  return id.split("-").at(-1) ?? id;
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
    clonedFromId: tab.clonedFromId ?? null,
    clonedFromName: tab.clonedFromName ? normalizeTabName(tab.clonedFromName, "") : null,
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

function isSnapMode(value: unknown): value is SnapMode {
  return typeof value === "string" && SNAP_MODES.includes(value as SnapMode);
}

function nextSnapMode(mode: SnapMode): SnapMode {
  const index = SNAP_MODES.indexOf(mode);
  return SNAP_MODES[(index + 1) % SNAP_MODES.length];
}

function snapModeLabel(mode: SnapMode) {
  if (mode === "top-left") return "top-left";
  if (mode === "center") return "center";
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

function cloneLayoutTab(source: LayoutTab): LayoutTab {
  const nextTabId = uid("tab");
  const now = new Date().toISOString();

  return {
    ...source,
    id: nextTabId,
    name: formatCloneName(nextTabId),
    clonedFromId: source.id,
    clonedFromName: source.name,
    createdAt: now,
    updatedAt: now,
    layout: {
      ...source.layout,
      tools: source.layout.tools.map((tool) => ({
        ...tool,
        id: uid("tool"),
      })),
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
  const response = await fetch(`/api/tabs/${tab.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Author-Id": authorId },
    body: JSON.stringify(stripSyncMetadata(tab)),
  });

  if (!response.ok) {
    throw new RequestError(await readFailedSyncMessage(response), response.status);
  }

  return (await response.json()) as SaveResponse;
}

class LimitError extends Error { }

const TERMINAL_SYNC_STATUSES = new Set([400, 401, 403, 409, 422, 429]);

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
    throw new RequestError(await readFailedSyncMessage(response), response.status);
  }

  return (await response.json()) as SaveResponse;
}

async function deleteTabFromDb(tabId: string, authorId: string) {
  const response = await fetch(`/api/tabs/${tabId}`, {
    method: "DELETE",
    headers: { "X-Author-Id": authorId },
  });

  if (!response.ok) {
    throw new RequestError(await readFailedSyncMessage(response), response.status);
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

const SCOPE_COLORS = {
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
}: {
  status: ReturnType<typeof getDisketteStatus>;
  label: string;
  offline: boolean;
  syncError?: string;
}) {
  const statusLabel = syncError ? `${label}: ${syncError}` : label;

  return (
    <div
      className={`diskette-status ${status} ${offline ? "offline" : ""}`}
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

function App() {
  const [localUserId] = useState(() => getOrCreateUserId());
  const [tabs, setTabs] = useState<LayoutTab[]>(() => orderTabs(withStaticNowTab(seedTabs.map(normalizeTab), STATIC_NOW_TAB)));
  const [activeTabId, setActiveTabId] = useState(() => loadActiveTabId() ?? tabs[0]?.id ?? seedTabs[0].id);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [gridDark, setGridDark] = useState(() => loadControls().gridDark ?? true);
  const [snapMode, setSnapMode] = useState<SnapMode>(() => {
    const mode = loadControls().snapMode;
    return isSnapMode(mode) ? mode : "top-left";
  });
  const [showInfra, setShowInfra] = useState(() => loadControls().showInfra ?? false);
  const [showMezz, setShowMezz] = useState(() => loadControls().showMezz ?? true);
  const debugPanel = useDebugPanel();
  const [showAddTool, setShowAddTool] = useState(false);
  const [addToolForm, setAddToolForm] = useState({
    name: "",
    x: "",
    y: "",
    scope: "undefined" as NonNullable<ToolShape["scope"]>,
    hazards: [] as NonNullable<ToolShape["hazards"]>,
  });
  const [addToolErrors, setAddToolErrors] = useState<Record<string, boolean>>({});
  const [draggingToolId, setDraggingToolId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [viewBox, setViewBox] = useState<ViewBox>(FULL_VIEWBOX);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const deleteZoneRef = useRef<HTMLDivElement | null>(null);
  const activeTabButtonRef = useRef<HTMLElement | null>(null);
  const dragState = useRef<DragState>(null);
  const panState = useRef<PanState>(null);
  const syncFlushTimer = useRef<number | null>(null);
  const localWriteTimer = useRef<number | null>(null);
  const saveDelayMs = useRef<number>(DEFAULT_SAVE_DELAY_MS);
  const [tutorialStep, setTutorialStep] = useState<null | TutorialStep>(null);
  const [clonePrompt, setClonePrompt] = useState<ClonePrompt>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [dbReachable, setDbReachable] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [syncInFlight, setSyncInFlight] = useState(false);
  const deleteProximityRef = useRef(0);
  const tabsRef = useRef<LayoutTab[]>(tabs);
  const syncInFlightRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);
  const clonePromptRunRef = useRef(0);
  const localAuthorTabCountRef = useRef(0);
  const initialized = useRef(false);

  const displayedTabs = visibleTabs(tabs);
  const activeTab = displayedTabs.find((tab) => tab.id === activeTabId) ?? displayedTabs[0] ?? tabs[0];
  const activeTabIsStaticNow = isStaticNowTab(activeTab);
  const activeTabHasLayout = activeTab?.hasLayout !== false;
  const selectedTool = activeTabHasLayout ? activeTab?.layout.tools.find((tool) => tool.id === selectedToolId) ?? null : null;
  const canOfferClone = !isClientAuthorTabLimitReached(tabs, localUserId);

  const canEdit = activeTabHasLayout && !activeTabIsStaticNow && (activeTab.canEdit === true || activeTab.authorId === localUserId);
  const pushDebugEvent = debugPanel.pushEvent;
  const disketteStatus = getDisketteStatus(tabs, dbReachable, syncInFlight);
  const disketteLabel = disketteStatusLabel(disketteStatus, dbReachable);
  const disketteSyncError = tabs.find((tab) => tab.syncError)?.syncError;

  const setActiveTabElement = useCallback((element: HTMLElement | null) => {
    activeTabButtonRef.current = element;
  }, []);

  const triggerClonePrompt = useCallback((tabId = activeTabId) => {
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
  }, [activeTabId]);

  const paintDeleteZone = useCallback((level: number) => {
    const clampedLevel = clamp(level, 0, 1);
    deleteProximityRef.current = clampedLevel;
    const zone = deleteZoneRef.current;
    if (!zone) return;
    const visibleLevel = Math.max(clampedLevel, tutorialStep === "delete" ? 1 : 0);
    zone.style.setProperty("--delete-zone-level", String(visibleLevel));
    zone.classList.toggle("shaking", clampedLevel === 1);
  }, [tutorialStep]);

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
          updatedAt: dirtyAt,
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

  const flushUnsyncedTabs = useCallback(async () => {
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
            await deleteTabFromDb(draft.id, localUserId);
            setDbReachable(true);
            setTabs((current) => current.filter((tab) => tab.id !== draft.id));
            pushDebugEvent("delete ok");
            continue;
          }

          if (draft.syncState === "local-only") {
            pushDebugEvent("clone retry start");
            const { tab } = await persistClone(normalizeTab(draft), localUserId);
            setDbReachable(true);
            setTabs((current) => orderTabs(current.map((item) => (item.id === draft.id ? withSyncedState(normalizeTab(tab)) : item))));
            pushDebugEvent("clone ok");
            continue;
          }

          pushDebugEvent("save start");
          const { tab } = await saveTab(normalizeTab(draft), localUserId);
          setDbReachable(true);
          setTabs((current) => current.map((item) => (item.id === tab.id ? withSyncedState(normalizeTab(tab)) : item)));
          pushDebugEvent("save ok");
        } catch (err) {
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

    if (tutorialStep === "add") {
      setShowAddTool(true);
    }

    const timer = window.setTimeout(() => {
      const currentIndex = TUTORIAL_STEPS.indexOf(tutorialStep);
      const nextStep = TUTORIAL_STEPS[currentIndex + 1] ?? null;

      if (nextStep === "add") {
        setShowAddTool(true);
      }
      if (tutorialStep === "add") {
        setShowAddTool(false);
      }

      setTutorialStep(nextStep);
    }, TUTORIAL_STEP_MS);

    return () => window.clearTimeout(timer);
  }, [tutorialStep]);

  useEffect(() => {
    if (!canEdit) {
      setShowAddTool(false);
    }
  }, [activeTabId, canEdit]);

  useEffect(() => () => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
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
    paintDeleteZone(deleteProximityRef.current);
  }, [paintDeleteZone]);

  useEffect(() => {
    let cancelled = false;

    const loadTabs = async () => {
      try {
        const savedTabId = loadActiveTabId();
        const cachedTabs = orderTabs(withStaticNowTab((await readCachedTabs(savedTabId)).map(normalizeTab), STATIC_NOW_TAB));
        if (!cancelled && cachedTabs.length > 0) {
          tabsRef.current = cachedTabs;
          setTabs(cachedTabs);
          setActiveTabId((current) => {
            const cachedActiveTabId = loadActiveTabId(visibleTabs(cachedTabs));
            if (cachedActiveTabId) return cachedActiveTabId;
            const visible = visibleTabs(cachedTabs);
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
  }, [localUserId, pushDebugEvent]);

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
      JSON.stringify({ gridDark, snapMode, showInfra, showMezz })
    );
  }, [gridDark, snapMode, showInfra, showMezz]);

  useEffect(() => {
    if (!cacheReady) return;

    if (localWriteTimer.current) {
      window.clearTimeout(localWriteTimer.current);
    }
    localWriteTimer.current = window.setTimeout(() => {
      void writeTabCacheSnapshot(orderTabs(tabsRef.current.filter((tab) => !isStaticNowTab(tab)).map(normalizeTab)))
        .then(() => {
          pushDebugEvent("cache write ok");
        })
        .catch(() => {
          pushDebugEvent("cache write failed");
        })
        .finally(() => {
          localWriteTimer.current = null;
        });
    }, LOCAL_WRITE_DELAY_MS);

    if (!initialized.current || syncInFlightRef.current || !dbReachable) return;
    if (hasFlushableTabs(tabs)) {
      scheduleSyncFlush(saveDelayMs.current);
      saveDelayMs.current = DEFAULT_SAVE_DELAY_MS;
    }
  }, [cacheReady, dbReachable, pushDebugEvent, scheduleSyncFlush, tabs]);

  useEffect(() => {
    activeTabButtonRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeTabId, tabs.length]);

  const startToolDrag = (event: ReactPointerEvent<SVGGElement>, tool: ToolShape) => {
    event.stopPropagation();
    if (!canEdit) {
      triggerClonePrompt();
      return;
    }

    if (event.button === 2 || event.ctrlKey) {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          return {
            ...tab,
            layout: {
              ...tab.layout,
              tools: tab.layout.tools.map((t) => (t.id === tool.id ? { ...t, rotation: (t.rotation + 45) % 360 } : t)),
            },
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      markTabDirty(activeTabId, "Saving in background");
      return;
    }

    const matrix = svgRef.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    const local = svgPointFromMatrix(matrix, event.clientX, event.clientY);
    if (!local) return;
    const deleteRect = deleteZoneRef.current?.getBoundingClientRect();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
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
      deleteZoneCenter: deleteRect
        ? { x: deleteRect.left + deleteRect.width / 2, y: deleteRect.top + deleteRect.height / 2 }
        : null,
      isOverDelete: false,
    };
    setSelectedToolId(tool.id);
    setDraggingToolId(tool.id);
  };

  const moveToolDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
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

      if (current.deleteZoneCenter) {
        const dist = Math.hypot(event.clientX - current.deleteZoneCenter.x, event.clientY - current.deleteZoneCenter.y);
        const nextProximity = dist < 32 ? 1 : Math.max(0, 1 - dist / 300);
        current.isOverDelete = nextProximity === 1;
        paintDeleteZone(nextProximity);
      }
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
    const current = dragState.current;
    if (current && current.pointerId === event.pointerId) {
      dragState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      setDraggingToolId(null);

      if (current.isOverDelete) {
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            return {
              ...tab,
              layout: {
                ...tab.layout,
                tools: tab.layout.tools.filter((tool) => tool.id !== current.toolId),
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        markTabDirty(activeTabId, "Deleted tool");
      } else {
        const moved = Math.abs(current.latestX - current.originalX) > 0.01 || Math.abs(current.latestY - current.originalY) > 0.01;
        if (moved) {
          setTabs((currentTabs) =>
            currentTabs.map((tab) => {
              if (tab.id !== activeTabId) return tab;
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
                updatedAt: new Date().toISOString(),
              };
            }),
          );
          markTabDirty(activeTabId, "Moved tool");
        }
      }
      paintDeleteZone(0);
    }

    const pan = panState.current;
    if (pan && pan.pointerId === event.pointerId) {
      panState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      setIsPanning(false);
    }
  };

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest(".tool-node")) return;
    if (activeTabIsStaticNow && isStaticToolObjectTarget(event.target)) {
      triggerClonePrompt(activeTab.id);
      return;
    }
    if (!canEdit && !activeTabIsStaticNow) {
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
    if (!canEdit && !activeTabIsStaticNow) {
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

  const catchDebugCode = (event: React.KeyboardEvent<HTMLElement>) => {
    debugPanel.toggleFromKey(event.key);
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
    if (isClientAuthorTabLimitReached(tabsRef.current, localUserId)) {
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
      ...cloneLayoutTab(sourceTab),
      authorId: localUserId,
      hasLayout: true,
      syncState: "draft-clone" as const,
      dirtyAt,
      syncError: undefined,
      updatedAt: dirtyAt,
    };
    localAuthorTabCountRef.current += 1;
    setTabs((current) => orderTabs([...current, clone]));
    setActiveTabId(clone.id);
    setSelectedToolId(null);
    pushDebugEvent("clone draft created");

    if (!localStorage.getItem("pstbg3shwavep-tutorial-seen")) {
      setTutorialStep("zoom");
      localStorage.setItem("pstbg3shwavep-tutorial-seen", "true");
    }
  };

  const renameTab = (tabId: string, nextName: string) => {
    const trimmed = normalizeTabName(nextName, "");
    if (!trimmed || trimmed === NOW_TAB_NAME || tabs.some((tab) => tab.id === tabId && isStaticNowTab(tab))) {
      setRenamingTabId(null);
      return;
    }
    const previousName = tabs.find((tab) => tab.id === tabId)?.name;
    if (trimmed === previousName) {
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
            updatedAt: new Date().toISOString(),
          };
        }

        if (tab.clonedFromId === tabId || (!tab.clonedFromId && tab.clonedFromName === previousName)) {
          return {
            ...tab,
            clonedFromName: trimmed,
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
          ? { ...item, syncState: "delete-pending", dirtyAt, syncError: undefined, updatedAt: dirtyAt }
          : item,
      ),
    );
    saveDelayMs.current = 0;
    pushDebugEvent("delete queued");
  };

  const clearLocalDraft = () => {
    localStorage.removeItem(OLD_TABS_STORAGE_KEY);
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

    const newTool: ToolShape = {
      id: uid("tool"),
      assetId: "custom",
      name,
      x: cx,
      y: cy,
      width: w,
      height: h,
      rotation: 0,
      color: SCOPE_COLORS[addToolForm.scope] ?? SCOPE_COLORS.undefined,
      scope: addToolForm.scope,
      hazards: addToolForm.hazards.length > 0 ? addToolForm.hazards : undefined,
    };

    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        return {
          ...tab,
          layout: {
            ...tab.layout,
            tools: [...tab.layout.tools, newTool],
          },
        };
      })
    );
    markTabDirty(activeTabId, "saving in background");
    setShowAddTool(false);
    setAddToolForm({ name: "", x: "", y: "", scope: "undefined", hazards: [] });
    setAddToolErrors({});
  };

  return (
    <main className="app-shell">
      <section
        className="workspace"
        aria-label="Protospace Space Board The Board Game 3, Space Hard With A Vengeance Expansion Pack"
        tabIndex={0}
        onKeyDown={catchDebugCode}
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
            <DisketteStatusIcon status={disketteStatus} label={disketteLabel} offline={!dbReachable} syncError={disketteSyncError} />
            <div className="floorplan-controls" aria-label="Floorplan controls">
            {canEdit && (
              <button
                type="button"
                className={tutorialStep === "add" ? "tutorial-highlight" : ""}
                onClick={() => setShowAddTool((current) => (tutorialStep === "add" ? true : !current))}
              >
                {showAddTool ? "− add" : "+ add"}
              </button>
            )}
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
            </div>
          </div>
          {showAddTool && (
            <form className={`add-tool-form ${tutorialStep === "add" ? "tutorial-highlight" : ""}`} onSubmit={handleAddToolSubmit} noValidate>
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
                <select value={addToolForm.scope} onChange={(e) => setAddToolForm({ ...addToolForm, scope: e.target.value as any })}>
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
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 12 0 L 0 0 0 12" fill="none" stroke={`rgba(32,36,39,${gridDark ? "0.1" : "0.08"})`} strokeWidth={0.8} />
            </pattern>
            <pattern id="stage-grid" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(32,36,39,0.36)" strokeWidth={1.2} />
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
                  data-tool-asset-id={tool.assetId}
                  data-tool-scope={tool.scope}
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
                </g>
              );
            })}
          </g>
        </svg>
        {canEdit && (
          <div
            ref={deleteZoneRef}
            className={`delete-zone ${tutorialStep === "delete" ? "tutorial-pulse" : ""}`}
            aria-label="Drop here to delete"
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
        )}
      </section>

      <nav className="sheet-tabs" aria-label="Layout tabs">
        {displayedTabs.map((tab) => {
          const isNow = isStaticNowTab(tab);
          const isActive = tab.id === activeTabId;
          const isUserTab = tab.canEdit === true || tab.authorId === localUserId;
          const isRenameStep = tutorialStep === "rename" && isActive;
          const isClonePrompted = clonePrompt?.tabId === tab.id;

          return (
            <div
              key={tab.id}
              className="sheet-tab-wrap"
            >
              {!isNow && isUserTab && (
                <button
                  type="button"
                  className={`rename-tab ${isRenameStep ? "tutorial-highlight flashing always-visible" : ""}`}
                  onClick={() => {
                    setRenamingTabId(tab.id);
                    setRenameDraft(tab.name);
                  }}
                  title={`Rename ${tab.name}`}
                  aria-label={`Rename ${tab.name}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                    <path d="m13 7 4 4" />
                  </svg>
                </button>
              )}
              {!isNow && isUserTab && (
                <button
                  type="button"
                  className="delete-tab"
                  onClick={() => deleteClonedTab(tab)}
                  title={`Delete ${tab.name}`}
                  aria-label={`Delete ${tab.name}`}
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
                  title={`Clone ${tab.name}`}
                  aria-label={`Clone ${tab.name}`}
                >
                  <span aria-hidden="true">+</span>
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button
                  ref={tab.id === activeTab.id ? setActiveTabElement : undefined}
                  type="button"
                  className={tab.id === activeTab.id ? "sheet-tab active" : "sheet-tab"}
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
                    className={tab.id === activeTab.id ? "sheet-tab tab-name-input active" : "sheet-tab tab-name-input"}
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
        <div className="tutorial-overlay">
          <div className="tutorial-tip">
            {tutorialStep === "zoom" && (
              <>
                <div className="tutorial-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                  </svg>
                </div>
                <h3>Scroll to zoom</h3>
                <p>Use your mouse wheel to zoom in and out of the drawing.</p>
              </>
            )}
            {tutorialStep === "rotate" && (
              <>
                <div className="tutorial-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </div>
                <h3>Right-click to rotate</h3>
                <p>Right-click (or Ctrl+Click) any object to rotate it 45° clockwise.</p>
              </>
            )}
            {tutorialStep === "delete" && (
              <>
                <div className="tutorial-icon" style={{ color: "#ef4444" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </div>
                <h3>Drag to delete</h3>
                <p>Drag any object onto the garbage can at the bottom to remove it.</p>
              </>
            )}
            {tutorialStep === "add" && (
              <>
                <div className="tutorial-icon" style={{ color: "var(--accent)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <h3>Add new tools</h3>
                <p>Bring up the Add panel to spawn new equipment.</p>
              </>
            )}
            {tutorialStep === "rename" && (
              <>
                <div className="tutorial-icon" style={{ color: "var(--accent)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                    <path d="m13 7 4 4" />
                  </svg>
                </div>
                <h3>Rename this tab and create your Protospace!</h3>
              </>
            )}
            <div className="tutorial-progress-wrap">
              <div className="tutorial-progress-bar continuous" />
              <div className="tutorial-markers" style={{ position: "relative", height: "8px" }}>
                {TUTORIAL_STEPS.map((step, i) => {
                  const currentIndex = TUTORIAL_STEPS.indexOf(tutorialStep);
                  // Right to left placement: Zoom at 80%, Rename at 0%
                  const leftPercent = (4 - i) * 20;
                  return (
                    <div
                      key={step}
                      className={`tutorial-marker ${i >= currentIndex ? "filled" : ""}`}
                      style={{ position: "absolute", left: `${leftPercent}%`, transform: "translateX(-50%)" }}
                      title={step}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
