export type ToolShape = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  activity?:
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
    | "storage"
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
  syncState?: SyncState;
  dirtyAt?: string;
  syncError?: string;
  layout: Layout;
  createdAt?: string;
  updatedAt?: string;
};

export type SaveResponse = {
  tab: LayoutTab;
};

export type SyncState = "synced" | "dirty" | "saving" | "local-only" | "draft-clone" | "error" | "delete-pending";
