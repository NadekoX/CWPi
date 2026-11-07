import type { ModelProvider } from "../../models";

export function getProviderAuthenticationStatus(provider: ModelProvider): string {
  if (provider.credentialPreview) return "已保存 API Key";
  if (provider.authSource === "OAuth") return "OAuth 已登录";
  if (provider.kind === "builtin" && !provider.requiresApiKey && provider.supportsOAuth) {
    return provider.isConfigured ? "OAuth 已登录" : "尚未配置 OAuth";
  }
  if (provider.isConfigured) return provider.requiresApiKey ? "凭据已就绪" : "无需 API Key";
  return "尚未配置 API Key";
}
