import { vi } from 'vite-plus/test'

/** Resolve fixture image data without allowing unrelated network requests. */
export function mockFixtureImageFetch() {
  const originalFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (typeof input === 'string' && input.startsWith('data:image/gif;base64,')) {
      const encoded = input.slice(input.indexOf(',') + 1).split('#')[0]!
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      return Promise.resolve(new Response(new Blob([bytes], { type: 'image/gif' })))
    }
    return originalFetch(input, init)
  })
}
