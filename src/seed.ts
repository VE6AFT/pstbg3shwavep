import type { LayoutTab } from "./types";
import { makeStaticNowTab } from "./staticNow";

export const seedTabs: LayoutTab[] = [
  makeStaticNowTab(),
];
