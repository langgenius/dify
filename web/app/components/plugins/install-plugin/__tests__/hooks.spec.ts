import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates, fetchReleases, handleUpload } from '../hooks'

const { mockToastError, mockUploadGitHub } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUploadGitHub: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/service/plugins', () => ({
  uploadGitHub: mockUploadGitHub,
}))

const mockFetch = vi.fn<typeof fetch>()

describe('install-plugin/hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockToastError.mockReset()
    mockUploadGitHub.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchReleases', () => {
    it('requests the repository releases and formats the response', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            releases: [
              {
                tag: 'v1.0.0',
                assets: [{ downloadUrl: 'https://example.com/plugin.zip' }],
              },
            ],
          }),
          { status: 200 },
        ),
      )

      const releases = await fetchReleases('owner', 'repo')

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(mockFetch).toHaveBeenCalledWith('https://ungh.cc/repos/owner/repo/releases')
      expect(releases).toEqual([
        {
          tag_name: 'v1.0.0',
          assets: [
            {
              browser_download_url: 'https://example.com/plugin.zip',
              name: 'plugin.zip',
            },
          ],
        },
      ])
    })

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

  describe('handleUpload', () => {
    it('uploads the selected package and calls onSuccess', async () => {
      const expectedPackage = {
        manifest: { name: 'test-plugin' },
        unique_identifier: 'uid-123',
      }
      mockUploadGitHub.mockResolvedValue(expectedPackage)
      const onSuccess = vi.fn()

      const pkg = await handleUpload(
        'https://github.com/owner/repo',
        'v1.0.0',
        'plugin.difypkg',
        onSuccess,
      )

      expect(mockUploadGitHub).toHaveBeenCalledOnce()
      expect(mockUploadGitHub).toHaveBeenCalledWith(
        'https://github.com/owner/repo',
        'v1.0.0',
        'plugin.difypkg',
      )
      expect(onSuccess).toHaveBeenCalledOnce()
      expect(onSuccess).toHaveBeenCalledWith(expectedPackage)
      expect(pkg).toEqual(expectedPackage)
    })

    it('shows toast on upload error', async () => {
      mockUploadGitHub.mockRejectedValue(new Error('Upload failed'))

      await expect(handleUpload('url', 'v1', 'pkg')).rejects.toThrow('Upload failed')
      expect(mockToastError).toHaveBeenCalledOnce()
      expect(mockToastError).toHaveBeenCalledWith('Error uploading package')
    })
  })
})
