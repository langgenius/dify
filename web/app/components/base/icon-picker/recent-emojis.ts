import { createLocalStorageState } from 'foxact/create-local-storage-state'

export const [useRecentEmojis, useRecentEmojisValue] = createLocalStorageState<string[]>(
  'dify-icon-picker-recent-emojis',
  [],
)

export function addRecentEmoji(recent: string[] | null, emoji: string) {
  return [emoji, ...(recent ?? []).filter((item) => item !== emoji)].slice(0, 9)
}
