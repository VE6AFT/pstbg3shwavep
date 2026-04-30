import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VALIDATION_LIMITS } from "../functions/api/_shared";
import { seedTabs } from "./seed";
import type { Bay, LayoutTab, SaveResponse, ToolShape } from "./types";

const STORAGE_KEY = "makerspace-floorplan-tabs-v3";
const ACTIVE_TAB_STORAGE_KEY = "makerspace-floorplan-active-tab";

const BAY_LAYOUT: Bay[] = [
  { id: "bay-105", label: "105", x: 0, y: 0, width: 1188, height: 444 },
  { id: "bay-108", label: "108", x: 0, y: 516, width: 1164, height: 324 },
  { id: "bay-110", label: "110", x: 0, y: 840, width: 1164, height: 324 },
];
const STAGING_MARGIN = BAY_LAYOUT[0].width / 2;

type SyncState = "idle" | "saving" | "saved" | "offline" | "error";
type DragState = {
  pointerId: number;
  toolId: string;
  offsetX: number;
  offsetY: number;
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
} | null;
type ClonePrompt = {
  tabId: string;
  run: number;
} | null;
type DebugEvent = {
  id: string;
  message: string;
};
const BAY_BOUNDS = BAY_LAYOUT.reduce(
  (bounds, bay) => ({
    minX: Math.min(bounds.minX, bay.x, -744), // Include mezzanine area
    minY: Math.min(bounds.minY, bay.y),
    maxX: Math.max(bounds.maxX, bay.x + bay.width),
    maxY: Math.max(bounds.maxY, bay.y + bay.height),
  }),
  { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);
const STAGE_BOUNDS = {
  minX: BAY_BOUNDS.minX - STAGING_MARGIN,
  minY: BAY_BOUNDS.minY - STAGING_MARGIN,
  maxX: BAY_BOUNDS.maxX + STAGING_MARGIN,
  maxY: BAY_BOUNDS.maxY + STAGING_MARGIN,
};
const FULL_VIEWBOX: ViewBox = {
  minX: STAGE_BOUNDS.minX,
  minY: STAGE_BOUNDS.minY,
  width: STAGE_BOUNDS.maxX - STAGE_BOUNDS.minX,
  height: STAGE_BOUNDS.maxY - STAGE_BOUNDS.minY,
};

const BAYS_ONLY_BOUNDS = BAY_LAYOUT.reduce(
  (bounds, bay) => ({
    minX: Math.min(bounds.minX, bay.x),
    minY: Math.min(bounds.minY, bay.y),
    maxX: Math.max(bounds.maxX, bay.x + bay.width),
    maxY: Math.max(bounds.maxY, bay.y + bay.height),
  }),
  { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);

const FIT_BAYS_VIEWBOX: ViewBox = {
  minX: BAYS_ONLY_BOUNDS.minX - 160,
  minY: BAYS_ONLY_BOUNDS.minY - 160,
  width: (BAYS_ONLY_BOUNDS.maxX - BAYS_ONLY_BOUNDS.minX) + 320,
  height: (BAYS_ONLY_BOUNDS.maxY - BAYS_ONLY_BOUNDS.minY) + 320,
};
const MIN_ZOOM_WIDTH = FULL_VIEWBOX.width / 8;
const MIN_ZOOM_HEIGHT = FULL_VIEWBOX.height / 8;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getOrCreateUserId() {
  const key = "makerspace-floorplan-user-id";
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

function tabSortTime(tab: LayoutTab) {
  const value = tab.createdAt ?? tab.updatedAt;
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function isNowTab(tab: LayoutTab) {
  return tab.id === "tab-default" || tab.name === "Now" || tab.name === "Baseline Layout";
}

function orderTabs(tabs: LayoutTab[]) {
  return [...tabs].sort((a, b) => {
    const aNow = isNowTab(a);
    const bNow = isNowTab(b);
    if (aNow !== bNow) return aNow ? -1 : 1;
    if (aNow && bNow) return 0;

    const byTime = tabSortTime(a) - tabSortTime(b);
    if (byTime !== 0) return byTime;
    return a.name.localeCompare(b.name);
  });
}

function formatDisplayDate(value?: string) {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function estimateJsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function formatKiB(bytes: number) {
  const kib = bytes / 1024;
  return `${kib >= 10 ? kib.toFixed(0) : kib.toFixed(1)} KiB`;
}

function formatDebugTime() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour ?? ""}:${byType.minute ?? "00"}:${byType.second ?? "00"} ${byType.dayPeriod ?? ""
    }`.trim();
}

function normalizeTab(tab: LayoutTab, index = 0): LayoutTab {
  const isFirstSeed = tab.id === "tab-default" || tab.name === "Baseline Layout";

  return {
    ...tab,
    name: isFirstSeed ? "Now" : tab.name || `Sheet ${index + 1}`,
    clonedFromId: tab.clonedFromId ?? null,
    clonedFromName: tab.clonedFromName ?? null,
    baseSvgMarkup: tab.baseSvgMarkup ?? null,
    canEdit: tab.canEdit ?? false,
    layout: {
      ...tab.layout,
      bays: BAY_LAYOUT.map((bay) => ({ ...bay })),
      tools: tab.layout.tools.map((tool) => clampTool(tool)),
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampTool(tool: ToolShape): ToolShape {
  return {
    ...tool,
    x: clamp(tool.x, STAGE_BOUNDS.minX, STAGE_BOUNDS.maxX - tool.width),
    y: clamp(tool.y, STAGE_BOUNDS.minY, STAGE_BOUNDS.maxY - tool.height),
  };
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
      bays: BAY_LAYOUT.map((bay) => ({ ...bay })),
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

async function saveTab(tab: LayoutTab, authorId: string) {
  const response = await fetch(`/api/tabs/${tab.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Author-Id": authorId },
    body: JSON.stringify(tab),
  });

  if (!response.ok) {
    throw new Error(`Failed to save tab: ${response.status}`);
  }

  return (await response.json()) as SaveResponse;
}

class LimitError extends Error { }

async function persistClone(tab: LayoutTab, authorId: string) {
  const response = await fetch("/api/tabs/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Author-Id": authorId },
    body: JSON.stringify({ tab }),
  });

  if (response.status === 429) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new LimitError(body.error ?? "tab limit reached");
  }

  if (!response.ok) {
    throw new Error(`Failed to clone tab: ${response.status}`);
  }

  return (await response.json()) as SaveResponse;
}

async function deleteTabFromDb(tabId: string, authorId: string) {
  const response = await fetch(`/api/tabs/${tabId}`, {
    method: "DELETE",
    headers: { "X-Author-Id": authorId },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete tab: ${response.status}`);
  }
}

function loadCachedTabs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached = orderTabs((JSON.parse(raw) as LayoutTab[]).map(normalizeTab));
    return cached.length > 0 ? cached : null;
  } catch {
    return null;
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
  "textiles/leather": "#936639",
  training: "#29b6f6",
  wood: "#f1c40f",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
} as const;

const SyncIcon = ({ state }: { state: SyncState }) => {
  if (state === "idle" || state === "offline" || state === "error") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
  );
};

function App() {
  const [localUserId] = useState(() => getOrCreateUserId());
  const [tabs, setTabs] = useState<LayoutTab[]>(() => loadCachedTabs() ?? orderTabs(seedTabs.map(normalizeTab)));
  const [activeTabId, setActiveTabId] = useState(() => loadActiveTabId(tabs) ?? tabs[0]?.id ?? seedTabs[0].id);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("Local draft ready");
  const [gridDark, setGridDark] = useState(true);
  const [showInfra, setShowInfra] = useState(false);
  const [showMezz, setShowMezz] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>(() => [
    { id: uid("debug"), message: `${formatDebugTime()} boot localStorage:${STORAGE_KEY}` },
  ]);
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
  const [viewBox, setViewBox] = useState<ViewBox>(FIT_BAYS_VIEWBOX);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const deleteZoneRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const debugLogRef = useRef<HTMLDivElement | null>(null);
  const activeTabButtonRef = useRef<HTMLElement | null>(null);
  const dragState = useRef<DragState>(null);
  const panState = useRef<PanState>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingSaveTabId = useRef<string | null>(null);
  const saveDelayMs = useRef<number>(650);
  const debugCodeBuffer = useRef("");
  const [tutorialStep, setTutorialStep] = useState<null | "zoom" | "rotate" | "delete" | "add" | "rename">(null);
  const [clonePrompt, setClonePrompt] = useState<ClonePrompt>(null);
  const [deleteProximity, setDeleteProximity] = useState(0);
  const [dbDisabled, setDbDisabled] = useState(false);
  const [localWriteDisabled, setLocalWriteDisabled] = useState(false);
  const tabsRef = useRef<LayoutTab[]>(tabs);
  const flashTimerRef = useRef<number | null>(null);
  const clonePromptRunRef = useRef(0);
  const initialized = useRef(false);

  const isStorageAvailable = useMemo(() => {
    try {
      localStorage.setItem("__storage_test__", "test");
      localStorage.removeItem("__storage_test__");
      return true;
    } catch (e) {
      return false;
    }
  }, []);

  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const hoveredTab = hoveredTabId ? tabs.find((tab) => tab.id === hoveredTabId) ?? null : null;
  const selectedTool = activeTab?.layout.tools.find((tool) => tool.id === selectedToolId) ?? null;
  const baseSvgDataUrl = activeTab.baseSvgMarkup
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(activeTab.baseSvgMarkup)}`
    : null;

  const canEdit = showDebug || activeTab.canEdit === true || activeTab.authorId === localUserId;

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

  const pushDebugEvent = useCallback((message: string) => {
    setDebugEvents((current) => [
      ...current.slice(-30),
      { id: uid("debug"), message: `${formatDebugTime()} ${message}` },
    ]);
  }, []);

  const markTabDirty = useCallback((tabId: string, message: string, delayMs: number = 650) => {
    pendingSaveTabId.current = tabId;
    saveDelayMs.current = delayMs;
    setSyncState("saving");
    setSyncMessage(message);
    pushDebugEvent("queued write");
  }, [pushDebugEvent]);

  const setToolPosition = useCallback((toolId: string, x: number, y: number) => {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        return {
          ...tab,
          layout: {
            ...tab.layout,
            tools: tab.layout.tools.map((tool) =>
              tool.id === toolId
                ? clampTool({
                  ...tool,
                  x,
                  y,
                })
                : tool,
            ),
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, [activeTabId, markTabDirty]);

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

  const scheduleSave = useCallback((tabId: string, delayMs: number) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    saveTimer.current = window.setTimeout(async () => {
      const draft = tabsRef.current.find((tab) => tab.id === tabId);
      if (!draft) return;

      try {
        setSyncState("saving");
        pushDebugEvent("save start");

        if (dbDisabled) {
          throw new Error("DB connection disabled");
        }

        const { tab } = await saveTab(normalizeTab(draft), localUserId);
        setTabs((current) => current.map((item) => (item.id === tab.id ? normalizeTab(tab) : item)));
        setSyncState("saved");
        setSyncMessage("Saved to D1");
        pushDebugEvent("save ok");
      } catch {
        setSyncState("offline");
        const msg = dbDisabled ? "DB disabled" : (isLocalhost ? "localhost draft" : "Local draft; sync pending");
        setSyncMessage(msg);
        pushDebugEvent(`save failed (${dbDisabled ? "DB disabled" : "local only"})`);
      }
    }, delayMs);
  }, [localUserId, pushDebugEvent, dbDisabled, isLocalhost]);

  useEffect(() => {
    if (tutorialStep && tutorialStep !== "rename") {
      const timer = setTimeout(() => {
        const steps = ["zoom", "rotate", "delete", "add", "rename"] as const;
        const idx = steps.indexOf(tutorialStep as any);
        const next = steps[idx + 1];
        if (next === "add") setShowAddTool(true);
        if (tutorialStep === "add") setShowAddTool(false);
        setTutorialStep((next || null) as any);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [tutorialStep]);

  useEffect(() => {
    if (tutorialStep === "rename") {
      const handleDismiss = () => setTutorialStep(null);
      window.addEventListener("mousedown", handleDismiss, { once: true });
      return () => window.removeEventListener("mousedown", handleDismiss);
    }
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
  }, []);

  useEffect(() => {
    if (showAddTool && tutorialStep === "add") {
      const handleOutsideClick = (e: MouseEvent) => {
        const form = document.querySelector(".add-tool-form");
        if (form && !form.contains(e.target as Node)) {
          setShowAddTool(false);
          setTutorialStep("rename");
        }
      };
      window.addEventListener("mousedown", handleOutsideClick);
      return () => window.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [showAddTool, tutorialStep]);

  useEffect(() => {
    fetchTabs(localUserId)
      .then(({ tabs: remoteTabs }) => {
        if (remoteTabs.length === 0) return;
        const normalized = orderTabs(remoteTabs.map(normalizeTab));
        setTabs(normalized);
        setActiveTabId((current) => {
          const savedTabId = loadActiveTabId(normalized);
          if (savedTabId) return savedTabId;
          return normalized.some((tab) => tab.id === current) ? current : normalized[0].id;
        });
        setSyncState("saved");
        setSyncMessage("Loaded from D1");
        pushDebugEvent("fetch ok");
      })
      .catch(() => {
        setSyncState("offline");
        setSyncMessage("Using local seed data");
        pushDebugEvent("fetch failed (using local)");
      })
      .finally(() => {
        initialized.current = true;
      });
  }, [localUserId, pushDebugEvent]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    if (localWriteDisabled || !tabs.some((tab) => tab.id === activeTabId)) return;
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  }, [activeTabId, tabs, localWriteDisabled]);

  useEffect(() => {
    if (!localWriteDisabled) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orderTabs(tabs.map(normalizeTab))));
    }
    if (!initialized.current) return;
    if (pendingSaveTabId.current) {
      scheduleSave(pendingSaveTabId.current, saveDelayMs.current);
      pendingSaveTabId.current = null;
      saveDelayMs.current = 650;
    }
  }, [scheduleSave, tabs, localWriteDisabled]);

  useEffect(() => {
    if (!debugLogRef.current) return;
    debugLogRef.current.scrollTop = debugLogRef.current.scrollHeight;
  }, [debugEvents]);

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
      setSyncMessage("Clone tab to edit");
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
          };
        }),
      );
      markTabDirty(activeTabId, "Saving in background", 2000);
      return;
    }

    const local = getSvgPoint(event.clientX, event.clientY);
    if (!local) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      toolId: tool.id,
      offsetX: local.x - tool.x,
      offsetY: local.y - tool.y,
    };
    setSelectedToolId(tool.id);
    setDraggingToolId(tool.id);
  };

  const moveToolDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = dragState.current;
    if (current && current.pointerId === event.pointerId) {
      const local = getSvgPoint(event.clientX, event.clientY);
      if (!local) return;
      setToolPosition(current.toolId, local.x - current.offsetX, local.y - current.offsetY);

      // Calculate proximity to delete zone
      const dz = deleteZoneRef.current;
      if (dz) {
        const rect = dz.getBoundingClientRect();
        const dzCenterX = rect.left + rect.width / 2;
        const dzCenterY = rect.top + rect.height / 2;
        const dist = Math.hypot(event.clientX - dzCenterX, event.clientY - dzCenterY);

        const maxDist = 300;
        const prox = Math.max(0, 1 - dist / maxDist);
        setDeleteProximity(dist < 32 ? 1 : prox);
      }
      return;
    }

    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (event.clientX - pan.startClientX) * (pan.startViewBox.width / rect.width);
    const dy = (event.clientY - pan.startClientY) * (pan.startViewBox.height / rect.height);
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

      // Check if released over the delete zone
      if (deleteProximity === 1) {
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
        markTabDirty(activeTabId, "Moved tool");
      }
      setDeleteProximity(0);
    }

    const pan = panState.current;
    if (pan && pan.pointerId === event.pointerId) {
      panState.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      setIsPanning(false);
    }
  };

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canEdit) {
      setSyncMessage("Clone tab to edit");
      triggerClonePrompt();
      return;
    }
    if (event.target instanceof Element && event.target.closest(".tool-node")) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    panState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewBox: viewBox,
    };
    setIsPanning(true);
  };

  const zoomFloorplan = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
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
    if (event.key.length !== 1) return;
    debugCodeBuffer.current = `${debugCodeBuffer.current}${event.key}`.slice(-5);
    if (debugCodeBuffer.current === "IDDQD") {
      setShowDebug((current) => !current);
      debugCodeBuffer.current = "";
    }
  };

  const debugLines = useMemo(() => {
    const selected = selectedTool
      ? `${selectedTool.name} ${inchesToFeetInches(selectedTool.width)}x${inchesToFeetInches(selectedTool.height)}`
      : "none";
    const activeTabBytes = estimateJsonBytes(normalizeTab(activeTab));
    const totalTools = tabs.reduce((count, tab) => count + tab.layout.tools.length, 0);
    const totalBays = tabs.reduce((count, tab) => count + tab.layout.bays.length, 0);
    const totalBytes = estimateJsonBytes(tabs.map(normalizeTab));

    return [
      `selected: ${selected}`,
      `tab tools: ${activeTab.layout.tools.length} / ${VALIDATION_LIMITS.toolsPerTab}`,
      `tab bays: ${activeTab.layout.bays.length} / ${VALIDATION_LIMITS.baysPerTab}`,
      `tab json: ${formatKiB(activeTabBytes)} / ${formatKiB(VALIDATION_LIMITS.requestBytes)}`,
      `page tabs: ${tabs.length}`,
      `page tools: ${totalTools}`,
      `page bays: ${totalBays}`,
      `page json: ${formatKiB(totalBytes)}`,
      draggingToolId ? "dragging" : "ready",
    ];
  }, [activeTab, draggingToolId, selectedTool, tabs]);

  const handleCloneTab = async (source: LayoutTab) => {
    const clone = { ...cloneLayoutTab(source), authorId: localUserId };
    setTabs((current) => orderTabs([...current, clone]));
    setActiveTabId(clone.id);
    setSelectedToolId(null);
    setSyncState("saving");
    setSyncMessage("Cloning tab");
    pushDebugEvent("clone start");

    if (!localStorage.getItem("makerspace-tutorial-seen")) {
      setTutorialStep("zoom");
      if (!localWriteDisabled) {
        localStorage.setItem("makerspace-tutorial-seen", "true");
      }
    }

    try {
      const { tab } = await persistClone(clone, localUserId);
        setTabs((current) => orderTabs(current.map((item) => (item.id === clone.id ? normalizeTab(tab) : item))));
      setSyncState("saved");
      setSyncMessage("Clone saved to D1");
      pushDebugEvent("clone ok");
    } catch (err) {
      if (err instanceof LimitError) {
        // Roll back the optimistic add — limit hit server-side
        setTabs((current) => current.filter((t) => t.id !== clone.id));
        setActiveTabId(source.id);
        setSyncState("error");
        setSyncMessage(err.message);
        pushDebugEvent(`clone rejected: ${err.message}`);
        return;
      }
      pendingSaveTabId.current = clone.id;
      setSyncState("offline");
      setSyncMessage("Clone local; sync pending");
      pushDebugEvent("clone failed (local only)");
    }
  };

  const renameTab = (tabId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      setRenamingTabId(null);
      return;
    }
    const previousName = tabs.find((tab) => tab.id === tabId)?.name;

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
    markTabDirty(tabId, "Renamed tab");
  };

  const deleteClonedTab = async (tab: LayoutTab) => {
    if (tab.name === "Now") return;
    const fallbackTab = tabs.find((item) => item.id !== tab.id) ?? seedTabs.map(normalizeTab)[0];

    setTabs((current) => current.filter((item) => item.id !== tab.id));
    setActiveTabId((current) => (current === tab.id ? fallbackTab.id : current));
    setSelectedToolId(null);
    pushDebugEvent("delete start");

    try {
      await deleteTabFromDb(tab.id, localUserId);
      setSyncState("saved");
      setSyncMessage("Deleted tab from D1");
      pushDebugEvent("delete ok");
    } catch {
      setSyncState("offline");
      setSyncMessage("Deleted locally; D1 delete pending");
      pushDebugEvent("delete failed (local only)");
    }
  };

  const clearLocalDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    localStorage.removeItem("makerspace-floorplan-tabs-v2");
    localStorage.removeItem("makerspace-tutorial-seen");
    const freshTabs = orderTabs(seedTabs.map(normalizeTab));
    setTabs(freshTabs);
    setActiveTabId(freshTabs[0].id);
    setSelectedToolId(null);
    setSyncState("idle");
    setSyncMessage("Local draft cleared");
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

  const importBaseSvg = (file: File | undefined) => {
    if (!file) return;
    file.text().then((markup) => {
      let nowTabId = activeTabId;
      setTabs((current) =>
        current.map((tab) => {
          if (tab.name === "Now") {
            nowTabId = tab.id;
            return {
              ...tab,
              baseSvgMarkup: markup,
              updatedAt: new Date().toISOString(),
            };
          }
          return tab;
        }),
      );
      markTabDirty(nowTabId, "Imported base SVG");
      pushDebugEvent("import svg");
    });
  };

  const handleAddToolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const w = parseFeetInches(addToolForm.x);
    const h = parseFeetInches(addToolForm.y);

    const errors = {
      name: !addToolForm.name.trim(),
      x: !w,
      y: !h,
    };
    setAddToolErrors(errors);
    if (Object.values(errors).some(v => v)) return;

    const cx = viewBox.minX + viewBox.width / 2 - w / 2;
    const cy = viewBox.minY + viewBox.height / 2 - h / 2;

    const newTool: ToolShape = {
      id: uid("tool"),
      assetId: "custom",
      name: addToolForm.name,
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
        aria-label="Makerspace floorplan editor"
        tabIndex={0}
        onKeyDown={catchDebugCode}
      >
        {showDebug && (
          <div className={`debug-popover ${syncState}`} aria-live="polite">
            <button type="button" className="debug-close" onClick={() => setShowDebug(false)} title="Close Debug Panel">×</button>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <button
                  type="button"
                  className={`debug-icon-btn ${!isStorageAvailable || localWriteDisabled ? "disabled" : ""} ${syncState === "saving" ? "flicker" : ""}`}
                  onClick={() => setLocalWriteDisabled(!localWriteDisabled)}
                  title={localWriteDisabled ? "Enable Local Write" : "Disable Local Write"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`debug-icon-btn ${dbDisabled || syncState === "offline" || syncState === "error" ? "disabled" : ""}`}
                  onClick={() => setDbDisabled(!dbDisabled)}
                  title={dbDisabled ? "Enable Database Sync" : "Disable Database Sync"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
              <button type="button" className="debug-clear" onClick={() => importInputRef.current?.click()}>
                svg<br />import
              </button>
              <button type="button" className="debug-clear" onClick={clearLocalDraft}>
                clear<br />local
              </button>
              <button
                type="button"
                className="debug-clear"
                title="Clone the Now tab with a randomized owner to test unauthorized view"
                onClick={() => {
                  const nowTab = tabs.find((t) => t.name === "Now");
                  if (!nowTab) return;
                  const spoofId = `spoof-${Math.random().toString(36).slice(2, 8)}`;
                  const clone = { ...cloneLayoutTab(nowTab), authorId: spoofId, name: `spoof:${spoofId.slice(6)}` };
                  setTabs((current) => orderTabs([...current, clone]));
                  setActiveTabId(clone.id);
                  pushDebugEvent(`spoof tab created owner:${spoofId}`);
                }}
              >
                spoof<br />tab
              </button>
              <button type="button" className="debug-clear" style={{ opacity: 0.5 }}>
                future<br />feature
              </button>
            </div>
            {debugLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
            <input
              ref={importInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              hidden
              onChange={(event) => importBaseSvg(event.target.files?.[0])}
            />
            <div ref={debugLogRef} className="debug-log" aria-label="Database write log">
              {debugEvents.map((event) => (
                <span key={event.id}>{event.message}</span>
              ))}
            </div>
          </div>
        )}

        <div className="bottom-controls-wrap">
          <div className="floorplan-controls" aria-label="Floorplan controls">
            {canEdit && (
              <button
                type="button"
                className={tutorialStep === "add" ? "tutorial-highlight" : ""}
                onClick={() => setShowAddTool(!showAddTool)}
              >
                {showAddTool ? "− add" : "+ add"}
              </button>
            )}
            <label>
              <input type="checkbox" checked={gridDark} onChange={(event) => setGridDark(event.target.checked)} />
              grid
            </label>
            <label>
              <input type="checkbox" checked={showMezz} onChange={(event) => setShowMezz(event.target.checked)} />
              mezz
            </label>
            <label>
              <input type="checkbox" checked={showInfra} onChange={(event) => setShowInfra(event.target.checked)} />
              infra
            </label>
            <button type="button" onClick={exportSvg}>export</button>
            <button type="button" onClick={exportPng}>photo</button>
          </div>
          {showAddTool && (
            <form className={`add-tool-form ${tutorialStep === "add" ? "tutorial-glow" : ""}`} onSubmit={handleAddToolSubmit} noValidate>
              <label>
                {addToolErrors.name && <span className="error-bubble">req'd</span>}
                <input type="text" autoFocus value={addToolForm.name} onChange={(e) => setAddToolForm({ ...addToolForm, name: e.target.value })} />
              </label>
              <div className="row">
                <label>
                  {addToolErrors.x && <span className="error-bubble">req'd</span>}
                  <input
                    type="text"
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
                  {addToolErrors.y && <span className="error-bubble">req'd</span>}
                  <input
                    type="text"
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
          ].filter(Boolean).join(" ")}
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label="Bays 105, 108, and 110 with draggable tool shapes"
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
            <pattern id="bay-grid" width="12" height="12" patternUnits="userSpaceOnUse">
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


          <g id="layer-bays" {...{ "inkscape:label": "bays", "inkscape:groupmode": "layer" }}>
            {activeTab.layout.bays.map((bay) => (
              <g key={bay.id} id={bay.id} {...{ "inkscape:label": `bay ${bay.label}` }}>
                <rect
                  x={bay.x} y={bay.y} width={bay.width} height={bay.height} rx={2}
                  fill="#ffffff" stroke="#30383a" strokeWidth={2}
                />
                <text x={bay.x + bay.width + 24} y={bay.y + 44} fill="#252b2d" fontSize={34} fontWeight={850} fontFamily="sans-serif">
                  {bay.label}
                </text>
                <text x={bay.x + 24} y={bay.y + bay.height - 22} fill="#697074" fontSize={18} fontWeight={700} fontFamily="sans-serif">
                  {inchesToFeetInches(bay.width)} x {inchesToFeetInches(bay.height)}
                </text>
              </g>
            ))}
          </g>

          <g id="layer-infra" className="infra-layer" aria-label="Infrastructure layer" {...{ "inkscape:label": "infrastructure", "inkscape:groupmode": "layer" }}>
            <path id="infra-electrical" className="infra electrical" d="M -96 180 H 1120" fill="none" stroke="#3d6fd4" strokeWidth={2} strokeDasharray="8 4" strokeLinecap="round" />
            <path id="infra-gas" className="infra gas" d="M 160 -60 V 1120" fill="none" stroke="#e87c2a" strokeWidth={2} strokeDasharray="12 4" strokeLinecap="round" />
            <path id="infra-dust" className="infra dust" d="M 660 -48 V 1100 M 520 240 H 1030" fill="none" stroke="#a0522d" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
            <circle id="infra-node-electrical" className="infra-node electrical" cx="190" cy="180" r="10" fill="#3d6fd4" stroke="none" />
            <circle id="infra-node-gas" className="infra-node gas" cx="160" cy="520" r="10" fill="#e87c2a" stroke="none" />
            <circle id="infra-node-dust" className="infra-node dust" cx="660" cy="240" r="10" fill="#a0522d" stroke="none" />
          </g>

          <g id="layer-mezzanine" className="mezzanine-layer" aria-label="Mezzanine layer" {...{ "inkscape:label": "mezzanine", "inkscape:groupmode": "layer" }}>
            {showMezz && BAY_LAYOUT.map(bay => (
              <g key={`mezz-${bay.id}`} id={`mezz-${bay.id}`} transform={`translate(${-384} ${bay.y + (bay.height - 360) / 2})`}>
                <rect width={360} height={360} fill="#ffffff" stroke="#30383a" strokeWidth={2} rx={2} />
                <path d="M 0 0 L 360 360 M 360 0 L 0 360" stroke="#30383a" strokeWidth={1} opacity={0.6} />
                <text x={180} y={180} dominantBaseline="middle" textAnchor="middle" fill="#252b2d" fontSize={24} fontWeight={800} style={{ pointerEvents: "none", userSelect: "none" }}>MEZZ</text>
              </g>
            ))}
          </g>

          <g id="layer-grid-overlay" className="grid-layer" aria-label="Grid overlay layer">
            {gridDark && (
              <rect
                x={STAGE_BOUNDS.minX}
                y={STAGE_BOUNDS.minY}
                width={STAGE_BOUNDS.maxX - STAGE_BOUNDS.minX}
                height={STAGE_BOUNDS.maxY - STAGE_BOUNDS.minY}
                fill="url(#bay-grid)"
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>

          <g id="layer-tools" {...{ "inkscape:label": "tools", "inkscape:groupmode": "layer" }}>
            {activeTab.layout.tools.map((tool) => {
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
                  transform={`translate(${tool.x} ${tool.y}) rotate(${tool.rotation} ${tool.width / 2} ${tool.height / 2})`}
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
                          const hw = h === "dirt" ? 11 : h === "fire" ? 13 : h === "dust" ? 8 : h === "eyes" ? 8 : 6;
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
                                <g transform="translate(-8.1, -1.5) scale(0.7)">
                                  <path d="M5.926 20.574a7.26 7.26 0 0 0 3.039 1.511c.107.035.179-.105.107-.175-2.395-2.285-1.079-4.758-.107-5.873.693-.796 1.68-2.107 1.608-3.865 0-.176.18-.317.322-.211 1.359.703 2.288 2.25 2.538 3.515.394-.386.537-.984.537-1.511 0-.176.214-.317.393-.176 1.287 1.16 3.503 5.097-.072 8.19-.071.071 0 .212.072.177a8.761 8.761 0 0 0 3.003-1.442c5.827-4.5 2.037-12.48-.43-15.116-.321-.317-.893-.106-.893.351-.036.95-.322 2.004-1.072 2.707-.572-2.39-2.478-5.105-5.195-6.441-.357-.176-.786.105-.75.492.07 3.27-2.063 5.352-3.922 8.059-1.645 2.425-2.717 6.89.822 9.808z" fill="currentColor" />
                                </g>
                              )}
                              {h === "eyes" && (
                                <g transform="translate(0, 8)">
                                  <circle cx="0" cy="0" r="1.2" fill="white" />
                                  <circle cx="0" cy="0" r="0.6" fill="currentColor" />
                                </g>
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
            className={`delete-zone ${deleteProximity === 1 ? "shaking" : ""} ${tutorialStep === "delete" ? "tutorial-pulse" : ""}`}
            style={{
              background: `rgb(${203 - (203 - 239) * Math.max(deleteProximity, tutorialStep === "delete" ? 1 : 0)}, ${213 - (213 - 68) * Math.max(deleteProximity, tutorialStep === "delete" ? 1 : 0)}, ${225 - (225 - 68) * Math.max(deleteProximity, tutorialStep === "delete" ? 1 : 0)})`,
            }}
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
        {hoveredTab && hoveredTab.name !== "Now" && (
          <div className="tab-detail-popover" aria-live="polite">
            <span>cloned: {formatDisplayDate(hoveredTab.updatedAt)}</span>
            <span>from: {hoveredTab.clonedFromName ?? "none"}</span>
          </div>
        )}
      </section>

      <nav className="sheet-tabs" aria-label="Layout tabs">
        {tabs.map((tab) => {
          const isNow = tab.name === "Now";
          const isActive = tab.id === activeTabId;
          const isUserTab = showDebug || tab.canEdit === true || tab.authorId === localUserId;
          const isRenameStep = tutorialStep === "rename" && isActive;
          const isClonePrompted = clonePrompt?.tabId === tab.id;

          return (
            <div
              key={tab.id}
              className="sheet-tab-wrap"
              onMouseEnter={() => setHoveredTabId(tab.id)}
              onMouseLeave={() => setHoveredTabId(null)}
              onFocus={() => setHoveredTabId(tab.id)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setHoveredTabId(null);
                }
              }}
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
                    onChange={(event) => setRenameDraft(event.target.value)}
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
                <p>Use your mouse wheel to zoom in and out of the floorplan.</p>
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
                <h3>Rename this tab</h3>
                <p>Create your Protospace!</p>
              </>
            )}
            <div className="tutorial-progress-wrap">
              <div className="tutorial-progress-bar continuous" />
              <div className="tutorial-markers" style={{ position: "relative", height: "8px" }}>
                {(["zoom", "rotate", "delete", "add", "rename"] as const).map((step, i) => {
                  const stepsOrder = ["zoom", "rotate", "delete", "add", "rename"];
                  const currentIndex = stepsOrder.indexOf(tutorialStep || "");
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
