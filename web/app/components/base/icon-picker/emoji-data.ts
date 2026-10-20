import { queryOptions } from '@tanstack/react-query'
import { basePath } from '@/utils/var'
import { isEmojiSupported } from './emoji-support'

export type Emoji = {
  emoji: string
  label: string
  tags?: string[]
  group?: number
  subgroup?: number
  version: number
}

type Messages = {
  groups: { key: string; message: string; order: number }[]
  subgroups: { key: string; order: number }[]
}
export type EmojiGroup = { id: string; label: string; items: Emoji[] }

const catalogUrl = `${basePath}/emoji/emojibase-17.0.0/en`

async function fetchJson<T>(file: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${catalogUrl}/${file}.json`, { signal })
  if (!response.ok) throw new Error(`Unable to load emoji ${file}: ${response.status}`)
  return response.json()
}

export const emojiCatalogOptions = queryOptions({
  queryKey: ['emoji-catalog', catalogUrl],
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: async ({ signal }) => {
    const [emojis, messages] = await Promise.all([
      fetchJson<Emoji[]>('data', signal),
      fetchJson<Messages>('messages', signal),
    ])
    // Probe once per Unicode version, rather than reading pixels for every emoji.
    const versions = new Map<number, string>()
    for (const emoji of emojis) {
      if (!versions.has(emoji.version)) versions.set(emoji.version, emoji.emoji)
    }
    const supportedVersion =
      [...versions.keys()]
        .sort((a, b) => b - a)
        .find((version) => isEmojiSupported(versions.get(version)!)) ?? Infinity
    const flagGroups = new Set(
      messages.subgroups
        .filter((group) => group.key === 'country-flag' || group.key === 'subdivision-flag')
        .map((group) => group.order),
    )
    const supportsFlags = isEmojiSupported('🇪🇺')
    const supportedEmojis = emojis.filter(
      (emoji) =>
        emoji.version <= supportedVersion &&
        (supportsFlags || emoji.subgroup === undefined || !flagGroups.has(emoji.subgroup)),
    )
    return messages.groups
      .filter((group) => group.key !== 'component')
      .map((group) => ({
        id: group.key,
        label: group.message.charAt(0).toUpperCase() + group.message.slice(1),
        items: supportedEmojis
          .filter((emoji) => emoji.group === group.order)
          .map((emoji) => ({
            ...emoji,
            label: emoji.label.charAt(0).toUpperCase() + emoji.label.slice(1),
          })),
      }))
  },
})
