export function parseDirectAllowedOrigins({
  environment,
  name,
  value,
}: {
  readonly environment?: string | undefined;
  readonly name: string;
  readonly value?: string | undefined;
}): readonly string[] {
  const values = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!values?.length) {
    throw new Error(`${name} requires at least one origin`);
  }

  const production = environment?.trim().toLowerCase() === "production";
  const origins = new Set<string>();
  for (const origin of values) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw invalidOriginError(name);
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw invalidOriginError(name);
    }
    if (production && parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
      throw new Error(`${name} must use HTTPS for non-loopback origins in production`);
    }
    origins.add(origin);
  }
  return [...origins];
}

function invalidOriginError(name: string): Error {
  return new Error(`${name} must contain absolute HTTP(S) origins`);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}
