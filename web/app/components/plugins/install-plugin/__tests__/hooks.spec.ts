import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { checkForUpdates, fetchReleases } from '../hooks'

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mockToastError,
  },
}))

const mockFetch = vi.fn<typeof fetch>()

describe('install-plugin/hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockToastError.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchReleases', () => {
    it('returns no releases and reports a failed response', async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 500 }))

      const releases = await fetchReleases('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(mockFetch).toHaveBeenCalledWith('https://ungh.cc/repos/owner/repo/releases')
      expect(releases).toEqual([])
      expect(mockToastError).toHaveBeenCalledOnce()
      expect(mockToastError).toHaveBeenCalledWith('Failed to fetch repository releases')
    })
  })

  describe('checkForUpdates', () => {
    it('detects newer version available', () => {
      const releases = [
        { tag_name: 'v1.0.0', assets: [] },
        { tag_name: 'v2.0.0', assets: [] },
      ]
      const { needUpdate, toastProps } = checkForUpdates(releases, 'v1.0.0')

      expect(needUpdate).toBe(true)
      expect(toastProps.message).toContain('v2.0.0')
    })

    it('returns no update when current is latest', () => {
      const releases = [{ tag_name: 'v1.0.0', assets: [] }]
      const { needUpdate, toastProps } = checkForUpdates(releases, 'v1.0.0')

      expect(needUpdate).toBe(false)
      expect(toastProps.type).toBe('info')
    })

    it('returns error for empty releases', () => {
      const { needUpdate, toastProps } = checkForUpdates([], 'v1.0.0')

      expect(needUpdate).toBe(false)
      expect(toastProps.type).toBe('error')
      expect(toastProps.message).toContain('empty')
    })
  })
})
