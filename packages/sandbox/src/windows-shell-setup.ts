import {
  checkWindowsSandboxStatusAsync,
  installWindowsSandboxAsync,
  resolveSrtWin,
  VENDORED_SRT_WIN_EXE,
  verifyWindowsWfpEgress,
  WindowsSandboxError,
} from "@anthropic-ai/sandbox-runtime";

export function isWindowsShellEnabled(configured?: boolean): boolean {
  return configured ?? process.env.CWPI_EXPERIMENTAL_WINDOWS_SHELL === "1";
}

export async function prepareWindowsShellSandbox(): Promise<"ready" | "cancelled"> {
  const srtWin = resolveSrtWin({ path: VENDORED_SRT_WIN_EXE });
  const { user, wfp } = await checkWindowsSandboxStatusAsync({ srtWin });
  if (
    user.provisioned &&
    user.credPresent &&
    user.markerVersion === user.setupVersion &&
    wfp.state !== "absent"
  ) {
    try {
      await verifyWindowsWfpEgress({ srtWin });
      return "ready";
    } catch (error: unknown) {
      if (!(error instanceof WindowsSandboxError) || error.code !== "wfp_fence_inactive")
        throw error;
    }
  }
  const result = await installWindowsSandboxAsync({ srtWin, skipProfileGrant: true });
  if (result.cancelled) return "cancelled";
  await verifyWindowsWfpEgress({ srtWin });
  return "ready";
}
