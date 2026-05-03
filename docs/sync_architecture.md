# Sync Architecture - Protospace Space Board (dev branch)

This document describes the synchronization model used in the Protospace Space Board floorplan editor. It is designed for both human review and to provide context for LLM agents working on the codebase.

## Overview

The application uses a **Lazy-Loading, Local-First** synchronization model. It balances immediate UI responsiveness with lightweight network usage by separating "Summaries" from "Full Layouts".

### Key Principles
1. **Metadata First**: The application loads the list of all tabs (metadata) first, without their heavy layout data.
2. **Lazy Layout Loading**: A tab's full layout (tools, positions) is only fetched from the server when the tab becomes active.
3. **Local Cache Source-of-Truth**: Changes are written to a local IndexedDB cache immediately, enabling offline persistence and session recovery.
4. **Optimistic UI**: Deletions, moves, and additions are reflected in the UI immediately, with a background process handling the server reconciliation.
5. **Optimistic Concurrency Control**: Uses `X-Expected-Updated-At` headers to prevent race conditions and accidental overwrites if multiple users edit the same tab.

---

## State Model (`syncState`)

Each `LayoutTab` object in the client state has a `syncState` property that governs its lifecycle:

| State | Description | Trigger |
| :--- | :--- | :--- |
| `synced` | Matches the server state exactly. | Load from server, or successful save/clone. |
| `dirty` | Has local changes to an existing tab that need to be pushed (PUT). | Tool move, rename, tool addition. |
| `local-only` | A new tab created locally that hasn't been saved to the server (POST). | Cloning a tab. |
| `draft-clone` | A transient state for a clone that hasn't been "accepted" yet. | Initial clone trigger. |
| `saving` | Currently in flight (API request pending). | Background flush starts. |
| `error` | A terminal failure occurred (e.g., validation error, 403). | API failure with terminal status code. |
| `delete-pending`| Marked for deletion; hidden from UI but waiting for server confirmation (DELETE).| User deletes a tab. |

---

## Primary Functions

### 1. Client-Side (`src/tabSync.ts`)

- **`mergeRemoteTabSummaries(remote, current)`**: The core reconciliation logic. It combines a list of remote summaries with current local tabs. 
    - *Logic*: If the server version is newer (`updatedAt`), the local version's layout is marked as missing (`hasLayout: false`), forcing a re-fetch of the new layout.
- **`getDisketteStatus(tabs, dbReachable, syncInFlight)`**: Calculates the overall sync status for the UI icon (Saving, Dirty, or Synced).
- **`isFlushableTab(tab)`**: Determines if a tab is in a state that should be pushed to the server (`dirty`, `local-only`, `delete-pending`).

### 2. Persistence Layer (`src/tabCache.ts`)

- **`writeTabCacheSnapshot(tabs)`**: Serializes the entire tab state (including metadata and layouts) to IndexedDB.
- **`readCachedTabs()`**: Hydrates the initial application state from the local cache on boot.
- **`applyCachedLayout(tab, layout)`**: Merges a cached layout into a tab metadata object if the timestamps match.

### 3. Orchestration (`src/App.tsx`)

- **`flushUnsyncedTabs()`**: An async loop that iterates through all "flushable" tabs and performs the necessary API calls (`PUT`, `POST`, or `DELETE`).
    - *Concurrency Guard*: Uses `isSamePersistedDraft` to check if the user made *further* changes while a save was in flight.
- **`loadLayout` (useEffect)**: Triggered when the active tab is missing its layout. It checks the local cache first, then falls back to a network fetch.
- **`markTabDirty(tabId, ...)`**: The standard way to transition a tab into a `dirty` state and schedule a background flush.

---

## API Interaction

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/tabs` | List metadata for all tabs (no layouts). |
| `GET` | `/api/tabs/:id` | Fetch the full layout for a specific tab. |
| `PUT` | `/api/tabs/:id` | Update an existing tab's layout/metadata. |
| `POST`| `/api/tabs/clone` | Create a new tab from a template. |
| `DELETE`| `/api/tabs/:id` | Delete a tab. |

---

## Potential Pitfalls & LLM Guidance

- **Concurrency**: Always check `updatedAt` before saving. The server will reject requests if `X-Expected-Updated-At` doesn't match.
- **Lazy Loading**: When working with tab data, check `hasLayout`. If false, the `layout` object contains dummy data until `loadLayout` finishes.
- **Deletion**: Tabs in `delete-pending` are currently filtered out of `displayedTabs`.
- **Author ID**: The application identifies the user via `X-Author-Id`. If this is missing or changed, the user loses "Edit" permissions on their tabs.
