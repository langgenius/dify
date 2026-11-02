import { expect, vi } from 'vite-plus/test'

/** Call explicitly during test setup and register the returned teardown with onTestFinished. */
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
