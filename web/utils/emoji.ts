/** Render persisted emoji icons; legacy Emoji Mart ids are normalized by the API. */
export function resolveEmoji(value?: string | null): string {
  if (!value) return '🤖'
  return value
}
