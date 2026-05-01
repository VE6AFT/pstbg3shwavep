type BuildInfo = {
  commitId: string;
  commitMessage: string;
};

declare const __BUILD_INFO__: BuildInfo | undefined;

const fallbackBuildInfo: BuildInfo = {
  commitId: "unknown",
  commitMessage: "commit message unavailable",
};

const injectedBuildInfo = typeof __BUILD_INFO__ === "undefined" ? fallbackBuildInfo : __BUILD_INFO__;

export const buildInfo: BuildInfo = {
  commitId: injectedBuildInfo.commitId || fallbackBuildInfo.commitId,
  commitMessage: injectedBuildInfo.commitMessage || fallbackBuildInfo.commitMessage,
};
