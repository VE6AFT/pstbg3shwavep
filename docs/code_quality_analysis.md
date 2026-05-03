# Code Quality & Modularization Analysis

This document analyzes the current structure of the `bg.ps.ai` codebase (specifically the `dev` branch) and proposes a strategy for modularization to improve maintainability and scalability.

## Current State

The main entry point, `App.tsx`, has grown to ~2100 lines. While it remains functional and relatively cohesive, it is becoming a "God Component" that handles:
1. **SVG Parsing & Tool Extraction**: Heavy logic for processing `now.svg`.
2. **State Management**: Managing tabs, tools, UI states (zoom, pan, tutorials).
3. **API Orchestration**: Complex async loops for background syncing.
4. **Direct SVG Manipulation**: Low-level pointer events and matrix transforms.
5. **UI Rendering**: The entire application layout, tab bar, debug panel, and tool forms.

## Proposed Modularization Plan

### 1. Extract Logic into Domain Utilities
Move non-React logic into pure TypeScript files:
- **`src/utils/svg.ts`**: Extract all SVG parsing logic (`parseSvgViewBox`, `extractSvgBody`, `extractStaticNowTools`, etc.).
- **`src/utils/math.ts`**: Extract geometry helpers (`clamp`, `snapToGrid`, `inchesToFeetInches`, `svgPointFromMatrix`).

### 2. Extract Business Logic into Custom Hooks
Move state orchestration out of `App.tsx`:
- **`useTabSync(tabs, authorId)`**: Move the `flushUnsyncedTabs` logic and the auto-sync `useEffect` into a dedicated hook.
- **`useWorkspace(viewBox, setViewBox)`**: Move the panning, zooming, and drag-and-drop logic into a hook. This would handle the `dragState` and `panState` refs.
- **`useTabPersistence()`**: Move the hydration and local cache snapshots logic.

### 3. Split into Functional Components
Break down the monolithic JSX:
- **`src/components/Workspace/Canvas.tsx`**: The main SVG element and its layers.
- **`src/components/Tabs/TabBar.tsx`**: The navigation tabs at the bottom.
- **`src/components/Controls/FloorplanControls.tsx`**: The diskette icon, grid/mezz/infra toggles, and add button.
- **`src/components/Forms/AddToolForm.tsx`**: The tool creation form.
- **`src/components/Debug/DebugPanel.tsx`**: (Already partially extracted).

### 4. Consolidate Type Definitions
- Move all core types (`LayoutTab`, `ToolShape`, `SyncState`) into a unified `src/types/index.ts` to avoid circular dependencies and make imports cleaner.

## Code Quality Improvements

1. **Inline Documentation**: Increase the use of JSDoc for complex functions in `App.tsx` and `tabSync.ts`.
2. **Error Boundary**: Implement a React Error Boundary around the `Workspace` to prevent entire app crashes on SVG rendering errors.
3. **Unit Testing**: Now that logic is being modularized into `src/utils`, it becomes significantly easier to write unit tests for SVG parsing and geometry calculations.
4. **Consistency**: Ensure all API interactions use the same `RequestError` and terminal error handling patterns established in `App.tsx`.

## Next Steps
- [ ] Create `src/utils/svg.ts` and migrate parsing logic.
- [ ] Create `src/hooks/useTabSync.ts`.
- [ ] Extract `TabBar` component.
- [ ] Audit `App.tsx` for remaining inline styles and move them to `styles.css`.
