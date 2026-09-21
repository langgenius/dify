/** A JSON object: not null, not an array. The one shape guard the whole CLI uses. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
