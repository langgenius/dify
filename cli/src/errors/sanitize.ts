const BEARER_PATTERN = /Bearer\s+([\w.~+/=-]+)/g

export function redactBearer(input: string): string {
  return input.replace(BEARER_PATTERN, 'Bearer [redacted]')
}
