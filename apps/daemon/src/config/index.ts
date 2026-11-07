import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4310;
const DEFAULT_WEB_SEARCH_URL = "http://127.0.0.1:8888";
const DEFAULT_WEB_URL = "http://127.0.0.1:5173";

const EnvironmentSchema = Type.Object({
  CWPI_DATABASE_PATH: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_DESKTOP_TOKEN: Type.Optional(Type.String({ minLength: 32, maxLength: 256 })),
  CWPI_HOST: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_LOG_LEVEL: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_PORT: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_GITHUB_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_GITHUB_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_GATEWAY_URL: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_GOOGLE_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_GOOGLE_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_NOTION_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_NOTION_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_SUPABASE_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_SUPABASE_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_VERCEL_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_SKILL_VERCEL_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_WEB_SEARCH_URL: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_WEB_DIST_PATH: Type.Optional(Type.String({ minLength: 1 })),
  CWPI_WEB_URL: Type.Optional(Type.String({ minLength: 1 })),
});

type HarnessEnvironment = Static<typeof EnvironmentSchema>;

export interface SkillOAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface HarnessConfig {
  allowedCommandPrefixesPath: string;
  credentialsPath: string;
  databasePath: string;
  desktopToken: string | null;
  globalRoot: string;
  host: string;
  logLevel: string;
  port: number;
  webSearchUrl: string;
  webDistPath: string | null;
  sessionsPath: string;
  sandboxCredentialsPath: string;
  skillCredentialsPath: string;
  skillGatewayUrl: string;
  skillOAuthClients: Readonly<Record<string, SkillOAuthClientConfig>>;
  webUrl: string;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CWPI_PORT must be an integer between 1 and 65535");
  }

  return port;
}

function parseLoopbackUrl(name: string, value: string): string {
  const url = new URL(value);
  const isLoopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "[::1]";

  // daemon 仅供本机访问。拒绝非回环地址，避免误配置远程绑定后，
  // OAuth 回调和本地凭据意外暴露为网络服务。
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopback) {
    throw new Error(`${name} must be an HTTP(S) loopback URL`);
  }

  return url.toString().replace(/\/$/, "");
}

function resolveSkillOAuthClients(
  env: HarnessEnvironment,
): Readonly<Record<string, SkillOAuthClientConfig>> {
  const configured = [
    ["github", env.CWPI_SKILL_GITHUB_CLIENT_ID, env.CWPI_SKILL_GITHUB_CLIENT_SECRET],
    ["google", env.CWPI_SKILL_GOOGLE_CLIENT_ID, env.CWPI_SKILL_GOOGLE_CLIENT_SECRET],
    ["notion", env.CWPI_SKILL_NOTION_CLIENT_ID, env.CWPI_SKILL_NOTION_CLIENT_SECRET],
    [
      "supabase",
      env.CWPI_SKILL_SUPABASE_CLIENT_ID,
      env.CWPI_SKILL_SUPABASE_CLIENT_SECRET,
    ],
    ["vercel", env.CWPI_SKILL_VERCEL_CLIENT_ID, env.CWPI_SKILL_VERCEL_CLIENT_SECRET],
  ] as const;
  const clients: Record<string, SkillOAuthClientConfig> = {};

  for (const [pluginId, clientId, clientSecret] of configured) {
    if (clientId === undefined && clientSecret === undefined) continue;
    if (clientId === undefined || clientSecret === undefined) {
      throw new Error(
        `CWPI_SKILL_${pluginId.toUpperCase()} OAuth client must be configured together`,
      );
    }
    clients[pluginId] = { clientId, clientSecret };
  }

  return clients;
}

/** 加载 daemon 专用配置，OAuth 密钥不会传递到 Web。 */
export function loadHarnessConfig(input: NodeJS.ProcessEnv = process.env): HarnessConfig {
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("CWPi environment configuration is invalid");
  }

  const env = input as HarnessEnvironment;
  const port = parsePort(env.CWPI_PORT);
  if (
    (env.CWPI_DESKTOP_TOKEN === undefined) !==
    (env.CWPI_WEB_DIST_PATH === undefined)
  ) {
    throw new Error(
      "CWPI_DESKTOP_TOKEN and CWPI_WEB_DIST_PATH must be configured together",
    );
  }
  const skillGatewayUrl = parseLoopbackUrl(
    "CWPI_SKILL_GATEWAY_URL",
    env.CWPI_SKILL_GATEWAY_URL ?? `http://127.0.0.1:${port}`,
  );
  const databasePath =
    env.CWPI_DATABASE_PATH ?? join(homedir(), ".CWPi", "harness.sqlite");
  const globalRoot = dirname(databasePath);
  return {
    allowedCommandPrefixesPath: join(globalRoot, "allowed-command-prefixes.json"),
    credentialsPath: join(globalRoot, "credentials.json"),
    databasePath,
    desktopToken: env.CWPI_DESKTOP_TOKEN ?? null,
    globalRoot,
    host: env.CWPI_HOST ?? DEFAULT_HOST,
    logLevel: env.CWPI_LOG_LEVEL ?? "info",
    sandboxCredentialsPath: join(globalRoot, "sandbox-credentials.json"),
    port,
    webSearchUrl: parseLoopbackUrl(
      "CWPI_WEB_SEARCH_URL",
      env.CWPI_WEB_SEARCH_URL ?? DEFAULT_WEB_SEARCH_URL,
    ),
    webDistPath:
      env.CWPI_WEB_DIST_PATH === undefined ? null : resolve(env.CWPI_WEB_DIST_PATH),
    sessionsPath: join(globalRoot, "sessions"),
    skillCredentialsPath: join(globalRoot, "skill-credentials.json"),
    skillGatewayUrl,
    skillOAuthClients: resolveSkillOAuthClients(env),
    webUrl: parseLoopbackUrl("CWPI_WEB_URL", env.CWPI_WEB_URL ?? DEFAULT_WEB_URL),
  };
}
