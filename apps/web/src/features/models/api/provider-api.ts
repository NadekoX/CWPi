import { ThinkingLevel } from "@cwpi/agent-runtime/thinking-level";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const ProviderSchema = Type.Object({
  authSource: Type.Union([Type.String(), Type.Null()]),
  baseUrl: Type.Union([Type.String(), Type.Null()]),
  canDelete: Type.Boolean(),
  credentialPreview: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
  hasStoredCredential: Type.Boolean(),
  id: Type.String(),
  isConfigured: Type.Boolean(),
  kind: Type.Union([Type.Literal("builtin"), Type.Literal("custom")]),
  models: Type.Array(
    Type.Object({
      contextWindow: Type.Integer({ minimum: 1 }),
      id: Type.String(),
      maxTokens: Type.Integer({ minimum: 1 }),
      name: Type.String(),
      reasoning: Type.Boolean(),
      thinkingLevels: Type.Array(
        Type.Union([
          Type.Literal(ThinkingLevel.OFF),
          Type.Literal(ThinkingLevel.MINIMAL),
          Type.Literal(ThinkingLevel.LOW),
          Type.Literal(ThinkingLevel.MEDIUM),
          Type.Literal(ThinkingLevel.HIGH),
          Type.Literal(ThinkingLevel.XHIGH),
          Type.Literal(ThinkingLevel.MAX),
        ]),
      ),
    }),
  ),
  name: Type.String(),
  protocol: Type.Union([Type.String(), Type.Null()]),
  requiresApiKey: Type.Boolean(),
  supportsOAuth: Type.Boolean(),
});

const ProviderListSchema = Type.Array(ProviderSchema);

export type ModelProvider = Static<typeof ProviderSchema>;

export const ProviderOAuthStatus = {
  AWAITING_INPUT: "awaiting_input",
  AWAITING_USER: "awaiting_user",
  COMPLETED: "completed",
  FAILED: "failed",
  STARTING: "starting",
} as const;

export const ProviderOAuthPromptType = {
  MANUAL_CODE: "manual_code",
  SECRET: "secret",
  SELECT: "select",
  TEXT: "text",
} as const;

const ProviderOAuthStartingSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 500 }),
  providerId: Type.String({ minLength: 1 }),
  status: Type.Literal(ProviderOAuthStatus.STARTING),
});

const ProviderOAuthAwaitingUserSchema = Type.Object({
  authorizationUrl: Type.String({ minLength: 1, maxLength: 4_096 }),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  providerId: Type.String({ minLength: 1 }),
  status: Type.Literal(ProviderOAuthStatus.AWAITING_USER),
  userCode: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
});

const ProviderOAuthAwaitingInputSchema = Type.Object({
  authorizationUrl: Type.Union([Type.String({ minLength: 1, maxLength: 4_096 }), Type.Null()]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  options: Type.Array(
    Type.Object({
      description: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
      id: Type.String({ minLength: 1, maxLength: 200 }),
      label: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    { maxItems: 50 },
  ),
  placeholder: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  promptId: Type.String({ minLength: 1, maxLength: 100 }),
  promptType: Type.Union([
    Type.Literal(ProviderOAuthPromptType.TEXT),
    Type.Literal(ProviderOAuthPromptType.SECRET),
    Type.Literal(ProviderOAuthPromptType.SELECT),
    Type.Literal(ProviderOAuthPromptType.MANUAL_CODE),
  ]),
  providerId: Type.String({ minLength: 1 }),
  status: Type.Literal(ProviderOAuthStatus.AWAITING_INPUT),
  userCode: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
});

const ProviderOAuthCompletedSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 500 }),
  providerId: Type.String({ minLength: 1 }),
  status: Type.Literal(ProviderOAuthStatus.COMPLETED),
});

const ProviderOAuthFailedSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 500 }),
  providerId: Type.String({ minLength: 1 }),
  status: Type.Literal(ProviderOAuthStatus.FAILED),
});

export const ProviderOAuthStateSchema = Type.Union([
  ProviderOAuthStartingSchema,
  ProviderOAuthAwaitingUserSchema,
  ProviderOAuthAwaitingInputSchema,
  ProviderOAuthCompletedSchema,
  ProviderOAuthFailedSchema,
]);

export type ProviderOAuthState = Static<typeof ProviderOAuthStateSchema>;

export interface ProviderInput {
  baseUrl: string;
  models: readonly ProviderModelInput[];
  name: string;
  protocol: "anthropic-messages" | "openai-completions" | "openai-responses";
  requiresApiKey: boolean;
}

export interface ProviderModelInput {
  contextWindow: number;
  id: string;
  maxTokens: number;
  reasoning: boolean;
}

export type ProviderUpdate = Partial<ProviderInput & { enabled: boolean }>;

export interface CustomProviderConnectionTestInput {
  apiKey?: string;
  baseUrl: string;
  modelId: string;
  protocol: ProviderInput["protocol"];
  requiresApiKey: boolean;
}

export class ProviderApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init?.method === undefined || init.method === "GET"
        ? {}
        : { "X-CWPi-Request": "1" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: unknown;
      message?: unknown;
    } | null;
    throw new ProviderApiError(
      response.status,
      typeof body?.code === "string" ? body.code : null,
      typeof body?.message === "string" ? body.message : `请求失败，状态码：${response.status}`,
    );
  }
  return response;
}

async function readProvider(response: Response): Promise<ModelProvider> {
  const body = (await response.json()) as unknown;
  if (!Value.Check(ProviderSchema, body)) throw new Error("daemon 返回了无效的 Provider 响应");
  return body;
}

export async function listProviders(): Promise<readonly ModelProvider[]> {
  const body = (await (await request("/api/providers")).json()) as unknown;
  if (!Value.Check(ProviderListSchema, body)) {
    throw new Error("daemon 返回了无效的 Provider 列表");
  }
  return body;
}

export async function createProvider(input: ProviderInput): Promise<ModelProvider> {
  return readProvider(
    await request("/api/providers", { body: JSON.stringify(input), method: "POST" }),
  );
}

export async function updateProvider(
  providerId: string,
  input: ProviderUpdate,
): Promise<ModelProvider> {
  return readProvider(
    await request(`/api/providers/${encodeURIComponent(providerId)}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    }),
  );
}

export async function deleteProvider(providerId: string): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" });
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}/credential`, {
    body: JSON.stringify({ apiKey }),
    method: "PUT",
  });
}

export async function deleteProviderCredential(providerId: string): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}/credential`, {
    method: "DELETE",
  });
}

export async function testProviderConnection(
  providerId: string,
  modelId: string,
  apiKey?: string,
): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}/test`, {
    body: JSON.stringify({ ...(apiKey === undefined ? {} : { apiKey }), modelId }),
    method: "POST",
  });
}

export async function testCustomProviderConnection(
  input: CustomProviderConnectionTestInput,
): Promise<void> {
  await request("/api/providers/test", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

const PROVIDER_OAUTH_REQUEST_TIMEOUT_MS = 15_000;

async function readProviderOAuthState(response: Response): Promise<ProviderOAuthState> {
  const body: unknown = await response.json();
  if (!Value.Check(ProviderOAuthStateSchema, body))
    throw new Error("daemon 返回了无效的 OAuth 状态");
  return body;
}

export async function startProviderOAuth(providerId: string): Promise<ProviderOAuthState> {
  return readProviderOAuthState(
    await request(`/api/providers/${encodeURIComponent(providerId)}/oauth`, {
      method: "POST",
      signal: AbortSignal.timeout(PROVIDER_OAUTH_REQUEST_TIMEOUT_MS),
    }),
  );
}

export async function getProviderOAuthState(providerId: string): Promise<ProviderOAuthState> {
  return readProviderOAuthState(
    await request(`/api/providers/${encodeURIComponent(providerId)}/oauth`, {
      signal: AbortSignal.timeout(PROVIDER_OAUTH_REQUEST_TIMEOUT_MS),
    }),
  );
}

export async function answerProviderOAuthPrompt(
  providerId: string,
  promptId: string,
  value: string,
): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}/oauth/prompt`, {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_OAUTH_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({ promptId, value }),
  });
}

export async function cancelProviderOAuth(providerId: string): Promise<void> {
  await request(`/api/providers/${encodeURIComponent(providerId)}/oauth`, {
    method: "DELETE",
    signal: AbortSignal.timeout(PROVIDER_OAUTH_REQUEST_TIMEOUT_MS),
  });
}
