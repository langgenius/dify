import legacyEmojis from './emoji-legacy.json'

/** Resolve persisted emoji-mart IDs (including aliases) without loading picker data. */
export function resolveEmoji(value?: string | null): string {
  if (!value) return '🤖'
  const id = value.replace(/^:|:$/g, '')
  if (Object.hasOwn(legacyEmojis, id)) return legacyEmojis[id as keyof typeof legacyEmojis]
  return value
}
