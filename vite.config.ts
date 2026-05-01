import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const FALLBACK_BUILD_INFO = {
  commitId: "unknown",
  commitMessage: "commit message unavailable",
};

function readGit(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readText(path: string) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function readGitHeadCommit() {
  const gitDir = `${process.cwd()}/.git`;
  const head = readText(`${gitDir}/HEAD`);

  if (!head) return "";
  if (!head.startsWith("ref: ")) return head.slice(0, 7);

  const refPath = head.replace("ref: ", "");
  return readText(`${gitDir}/${refPath}`).slice(0, 7);
}

function readGitLogMessage(commitId: string) {
  if (!commitId || commitId === FALLBACK_BUILD_INFO.commitId) return "";

  const lines = readText(`${process.cwd()}/.git/logs/HEAD`).split(/\r?\n/).reverse();
  for (const line of lines) {
    const match = line.match(/^[0-9a-f]+ ([0-9a-f]+) .*\t(.+)$/);
    if (!match || !match[1].startsWith(commitId)) continue;
    if (!match[2].startsWith("commit")) continue;

    return match[2].replace(/^commit(?: \([^)]+\))?: /, "");
  }

  return "";
}

function getBuildInfo() {
  const cloudflareCommit = process.env.CF_PAGES_COMMIT_SHA?.trim();
  const commitId = cloudflareCommit
    ? cloudflareCommit.slice(0, 7)
    : readGit(["rev-parse", "--short=7", "HEAD"]) || readGitHeadCommit() || FALLBACK_BUILD_INFO.commitId;
  const commitMessage =
    readGit(["log", "-1", "--pretty=%s"]) || readGitLogMessage(commitId) || FALLBACK_BUILD_INFO.commitMessage;

  return { commitId, commitMessage };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(getBuildInfo()),
  },
  build: {
    sourcemap: false,
  },
});
