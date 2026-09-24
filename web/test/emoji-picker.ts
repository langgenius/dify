import data from '@/public/emoji/emojibase-17.0.0/en/data.json'
import messages from '@/public/emoji/emojibase-17.0.0/en/messages.json'

/** Exercise the real picker with the same data served in production, without network. */
export function mockEmojiData() {
  beforeEach(() => {
    // oxlint-disable-next-line no-restricted-globals -- Reset Frimousse's own cache to exercise its data loader.
    localStorage.removeItem('frimousse/data/en')
    sessionStorage.removeItem('frimousse/metadata')
    sessionStorage.setItem(
      'frimousse/metadata',
      JSON.stringify({ emojiVersion: 17, countryFlags: true }),
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (!/^\/.*emoji\/emojibase-17\.0\.0\/en\/(?:data|messages)\.json$/.test(url))
        throw new Error(`Unexpected emoji data URL: ${url}`)
      return new Response(JSON.stringify(url.endsWith('/messages.json') ? messages : data))
    })
  })
  afterEach(() => vi.restoreAllMocks())
}
