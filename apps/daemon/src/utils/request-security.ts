import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { HarnessConfig } from "../config/index.js";
import { readDesktopAuthCookie } from "./auth-cookies.js";

const DESKTOP_AUTH_EXEMPT_ROUTES = new Set([
  "/api/health",
  "/api/mcp-servers/:serverId/authorizations/callback",
  "/api/skill-connections/:collectionId/oauth/callback",
  // The gateway validates its own per-process token before forwarding any request.
  "/api/skill-gateway/:collectionId/*",
]);

export function isDesktopTokenValid(expected: string, actual: string | null): boolean {
  if (actual === null) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function isDesktopRequestAllowed(config: HarnessConfig, request: FastifyRequest): boolean {
  if (config.desktopToken === null) return true;

  // Fastify may match an encoded URL to an API route, even if its raw prefix differs.
  const route = request.routeOptions.url;
  if (!route?.startsWith("/api/") && !request.url.startsWith("/api/")) return true;
  if (route !== undefined && DESKTOP_AUTH_EXEMPT_ROUTES.has(route)) return true;

  return isDesktopTokenValid(config.desktopToken, readDesktopAuthCookie(request.headers.cookie));
}

export function isMutationRequestAllowed(config: HarnessConfig, request: FastifyRequest): boolean {
  return (
    request.headers.origin === config.webUrl && request.headers["x-cwpi-request"] === "1"
  );
}

export function rejectMutation(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({
    code: "INVALID_REQUEST_ORIGIN",
    message: "The request origin is not allowed",
  });
}
