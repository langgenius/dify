export interface ApiPortEnv {
  readonly API_PORT?: string | undefined;
  readonly PORT?: string | undefined;
}

export function resolveApiPort(env: ApiPortEnv = process.env): number {
  const rawPort = env.PORT ?? env.API_PORT ?? "8788";

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("API port must be an integer");
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API port must be between 1 and 65535");
  }

  return port;
}
