import type { RefObject } from "react";
import type { DebugEvent } from "./useDebugPanel";

type DebugPanelProps = {
  debugLines: string[];
  editOverride: boolean;
  events: DebugEvent[];
  logRef: RefObject<HTMLDivElement | null>;
  onClearLocalDraft: () => void;
  onClose: () => void;
  onSpoofTab: () => void;
  onToggleEditOverride: () => void;
};

export function DebugPanel({
  debugLines,
  editOverride,
  events,
  logRef,
  onClearLocalDraft,
  onClose,
  onSpoofTab,
  onToggleEditOverride,
}: DebugPanelProps) {
  return (
    <div className="debug-popover" aria-label="Debug panel">
      <div className="debug-header">
        <button
          type="button"
          className={`debug-icon-btn ${editOverride ? "active" : ""}`}
          onClick={onToggleEditOverride}
          title={editOverride ? "Disable local edit override" : "Enable local edit override"}
          aria-label={editOverride ? "Disable local edit override" : "Enable local edit override"}
          aria-pressed={editOverride}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
          </svg>
        </button>
        <button type="button" className="debug-close" onClick={onClose} title="Close debug panel" aria-label="Close debug panel">
          x
        </button>
      </div>

      <div className="debug-actions">
        <button type="button" className="debug-action" onClick={onClearLocalDraft}>
          clear local
        </button>
        <button
          type="button"
          className="debug-action"
          title="Clone the Now tab with a randomized owner to test unauthorized view"
          onClick={onSpoofTab}
        >
          spoof tab
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
