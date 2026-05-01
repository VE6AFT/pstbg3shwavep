declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: {
      cwd?: string;
      encoding?: string;
      stdio?: unknown;
    },
  ): string;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
