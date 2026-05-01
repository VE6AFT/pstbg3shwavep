import type { RefObject } from "react";
import { buildInfo } from "./buildInfo";
import type { DebugEvent } from "./useDebugPanel";

type DebugPanelProps = {
  debugLines: string[];
  events: DebugEvent[];
  logRef: RefObject<HTMLDivElement | null>;
  onClearLocalDraft: () => void;
  onClose: () => void;
};

export function DebugPanel({
  debugLines,
  events,
  logRef,
  onClearLocalDraft,
  onClose,
}: DebugPanelProps) {
  const buildLabel = `${buildInfo.commitId} ${buildInfo.commitMessage}`;

  return (
    <div className="debug-popover" aria-label="Debug panel">
      <div className="debug-header">
        <span className="debug-version" title={buildLabel}>
          {buildLabel}
        </span>
        <button type="button" className="debug-close" onClick={onClose} title="Close debug panel" aria-label="Close debug panel">
          x
        </button>
      </div>

      <div className="debug-actions">
        <button type="button" className="debug-action" onClick={onClearLocalDraft}>
          clear local
        </button>
      </div>

      <div className="debug-metrics">
        {debugLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>

      <div ref={logRef} className="debug-log" aria-label="Debug event log">
        {events.map((event) => (
          <span key={event.id}>{event.message}</span>
        ))}
      </div>
    </div>
  );
}
