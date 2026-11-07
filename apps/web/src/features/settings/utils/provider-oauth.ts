import { type ModelProvider, type ProviderOAuthState, ProviderOAuthStatus } from "../../models";

export function isProviderOAuthActive(state: ProviderOAuthState | null): boolean {
  return (
    state?.status === ProviderOAuthStatus.STARTING ||
    state?.status === ProviderOAuthStatus.AWAITING_INPUT ||
    state?.status === ProviderOAuthStatus.AWAITING_USER
  );
}

export async function openProviderOAuthPage(url: string): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("授权页面必须使用 HTTPS");
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url: target.toString() });
    return;
  }
  window.open(target.toString(), "_blank", "noopener,noreferrer");
}

export const ProviderAuthenticationMethod = { API_KEY: "api-key", OAUTH: "oauth" } as const;
export type ProviderAuthenticationMethod =
  (typeof ProviderAuthenticationMethod)[keyof typeof ProviderAuthenticationMethod];

export function defaultProviderAuthenticationMethod(
  provider: ModelProvider | null,
): ProviderAuthenticationMethod {
  return provider?.supportsOAuth && (!provider.requiresApiKey || provider.authSource === "OAuth")
    ? ProviderAuthenticationMethod.OAUTH
    : ProviderAuthenticationMethod.API_KEY;
}
