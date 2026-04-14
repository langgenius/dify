import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates, fetchReleases, handleUpload } from '../hooks'

const mockNotify = vi.fn()
vi.mock('@/app/components/base/ui/toast', () => ({
  toast: Object.assign((...args: unknown[]) => mockNotify(...args), {
    success: (...args: unknown[]) => mockNotify(...args),
    error: (...args: unknown[]) => mockNotify(...args),
    warning: (...args: unknown[]) => mockNotify(...args),
    info: (...args: unknown[]) => mockNotify(...args),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }),
}))

const mockUploadGitHub = vi.fn()
vi.mock('@/service/plugins', () => ({
  uploadGitHub: (...args: unknown[]) => mockUploadGitHub(...args),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('install-plugin/hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useGitHubReleases', () => {
    describe('fetchReleases', () => {
      it('fetches releases from GitHub API and formats them', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            releases: [
              {
                tag: 'v1.0.0',
                assets: [{ downloadUrl: 'https://example.com/plugin.zip' }],
              },
            ],
          }),
        })

        const releases = await fetchReleases('owner', 'repo')

        expect(releases).toHaveLength(1)
        expect(releases[0].tag_name).toBe('v1.0.0')
        expect(releases[0].assets[0].name).toBe('plugin.zip')
        expect(releases[0]).not.toHaveProperty('body')
      })

      it('returns empty array and shows toast on fetch error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
        })

        const releases = await fetchReleases('owner', 'repo')

        expect(releases).toEqual([])
        expect(mockNotify).toHaveBeenCalledWith('Failed to fetch repository releases')
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
        const releases = [
          { tag_name: 'v1.0.0', assets: [] },
        ]
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

  describe('useGitHubUpload', () => {
    it('uploads successfully and calls onSuccess', async () => {
      const mockManifest = { name: 'test-plugin' }
      mockUploadGitHub.mockResolvedValue({
        manifest: mockManifest,
        unique_identifier: 'uid-123',
      })
      const onSuccess = vi.fn()

      const pkg = await handleUpload(
        'https://github.com/owner/repo',
        'v1.0.0',
        'plugin.difypkg',
        onSuccess,
      )

      expect(mockUploadGitHub).toHaveBeenCalledWith(
        'https://github.com/owner/repo',
        'v1.0.0',
        'plugin.difypkg',
      )
      expect(onSuccess).toHaveBeenCalledWith({
        manifest: mockManifest,
        unique_identifier: 'uid-123',
      })
      expect(pkg.unique_identifier).toBe('uid-123')
    })

    it('shows toast on upload error', async () => {
      mockUploadGitHub.mockRejectedValue(new Error('Upload failed'))

      await expect(
        handleUpload('url', 'v1', 'pkg'),
      ).rejects.toThrow('Upload failed')
      expect(mockNotify).toHaveBeenCalledWith('Error uploading package')
    })
  })
})
