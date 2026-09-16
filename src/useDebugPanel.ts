import { useCallback, useEffect, useRef, useState } from "react";

export type DebugEvent = {
  id: string;
  message: string;
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatDebugTime() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour ?? ""}:${byType.minute ?? "00"}:${byType.second ?? "00"} ${
    byType.dayPeriod ?? ""
  }`.trim();
}

const DEV_DEBUG_ORIGIN = "https://dev.pstbg3shwavep.pages.dev";
const LOCAL_DEBUG_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isDevDebugOrigin() {
  if (typeof window === "undefined") return false;
  return LOCAL_DEBUG_HOSTS.has(window.location.hostname) || window.location.origin === DEV_DEBUG_ORIGIN;
}

export function useDebugPanel(options: { onKeyDown?: (event: KeyboardEvent) => void } = {}) {
  const { onKeyDown } = options;
  const [showDevLauncher] = useState(() => isDevDebugOrigin());
  const [isVisible, setIsVisible] = useState(() => isDevDebugOrigin());
  const [events, setEvents] = useState<DebugEvent[]>(() => [
    { id: uid("debug"), message: `${formatDebugTime()} boot tab cache` },
  ]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const codeBuffer = useRef("");

  const pushEvent = useCallback((message: string) => {
    setEvents((current) => [
      ...current.slice(-30),
      { id: uid("debug"), message: `${formatDebugTime()} ${message}` },
    ]);
  }, []);

  const toggleFromKey = useCallback((key: string) => {
    if (key.length !== 1) return;
    codeBuffer.current = `${codeBuffer.current}${key}`.slice(-5);
    if (codeBuffer.current === "IDDQD") {
      setIsVisible((current) => !current);
      codeBuffer.current = "";
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      toggleFromKey(event.key);
      onKeyDown?.(event);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onKeyDown, toggleFromKey]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  return {
    events,
    isVisible,
    logRef,
    pushEvent,
    setIsVisible,
    showDevLauncher,
    toggleFromKey,
  };
}
