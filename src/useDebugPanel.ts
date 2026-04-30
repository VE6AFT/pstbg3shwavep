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

export function useDebugPanel() {
  const [isVisible, setIsVisible] = useState(false);
  const [editOverride, setEditOverride] = useState(false);
  const [events, setEvents] = useState<DebugEvent[]>(() => [
    { id: uid("debug"), message: `${formatDebugTime()} boot localStorage:makerspace-floorplan-tabs-v3` },
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
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  return {
    editOverride,
    events,
    isVisible,
    logRef,
    pushEvent,
    setEditOverride,
    setIsVisible,
    toggleFromKey,
  };
}
