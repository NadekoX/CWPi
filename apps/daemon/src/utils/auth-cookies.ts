const DESKTOP_AUTH_COOKIE = "cwpi_desktop";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  secure: boolean;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function createDesktopAuthCookie(token: string): string {
  return serializeCookie(DESKTOP_AUTH_COOKIE, token, {
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    path: "/",
    secure: false,
  });
}

export function readDesktopAuthCookie(header: string | undefined): string | null {
  return parseCookie(header, DESKTOP_AUTH_COOKIE);
}
