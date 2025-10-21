import { SearchIndex } from 'emoji-mart'
import type { Emoji } from '@emoji-mart/data'

export async function searchEmoji(value: string) {
  const emojis: Emoji[] = await SearchIndex.search(value) || []

  const results = emojis.map((emoji) => {
    return emoji.skins[0].native
  })
  return results
}
