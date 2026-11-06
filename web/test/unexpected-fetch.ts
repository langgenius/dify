import { expect, vi } from 'vite-plus/test'

export function guardUnexpectedFetch() {
  const unexpectedFetch = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('Unexpected network request'))
  vi.stubGlobal('fetch', unexpectedFetch)

  return () => {
    try {
      expect(unexpectedFetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  }
}
