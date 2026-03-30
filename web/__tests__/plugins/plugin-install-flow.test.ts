/**
 * Integration Test: Plugin Installation Flow
 *
 * Tests the integration between GitHub release fetching, version comparison,
 * upload handling, and task status polling. Verifies the complete plugin
 * installation pipeline from source discovery to completion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates, fetchReleases, handleUpload } from '@/app/components/plugins/install-plugin/hooks'

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/ui/toast', () => ({
  toast: Object.assign((message: string, options?: { type?: string }) => mockToastNotify({ type: options?.type, message }), {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }),
}))

const mockUploadGitHub = vi.fn()
vi.mock('@/service/plugins', () => ({
  uploadGitHub: (...args: unknown[]) => mockUploadGitHub(...args),
  checkTaskStatus: vi.fn(),
}))

describe('Plugin Installation Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  describe('GitHub Release Discovery → Version Check → Upload Pipeline', () => {
    it('fetches releases, checks for updates, and uploads the new version', async () => {
      const mockReleases = [
        {
          tag: 'v2.0.0',
          assets: [{ downloadUrl: 'https://github.com/test/v2.difypkg' }],
        },
        {
          tag: 'v1.5.0',
          assets: [{ downloadUrl: 'https://github.com/test/v1.5.difypkg' }],
        },
        {
          tag: 'v1.0.0',
          assets: [{ downloadUrl: 'https://github.com/test/v1.difypkg' }],
        },
      ]

      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ releases: mockReleases }),
      })

      mockUploadGitHub.mockResolvedValue({
        manifest: { name: 'test-plugin', version: '2.0.0' },
        unique_identifier: 'test-plugin:2.0.0',
      })

      const releases = await fetchReleases('test-org', 'test-repo')
      expect(releases).toHaveLength(3)
      expect(releases[0].tag_name).toBe('v2.0.0')

      const { needUpdate, toastProps } = checkForUpdates(releases, 'v1.0.0')
      expect(needUpdate).toBe(true)
      expect(toastProps.message).toContain('v2.0.0')

      const onSuccess = vi.fn()
      const result = await handleUpload(
        'https://github.com/test-org/test-repo',
        'v2.0.0',
        'plugin-v2.difypkg',
        onSuccess,
      )

      expect(mockUploadGitHub).toHaveBeenCalledWith(
        'https://github.com/test-org/test-repo',
        'v2.0.0',
        'plugin-v2.difypkg',
      )
      expect(onSuccess).toHaveBeenCalledWith({
        manifest: { name: 'test-plugin', version: '2.0.0' },
        unique_identifier: 'test-plugin:2.0.0',
      })
      expect(result).toEqual({
        manifest: { name: 'test-plugin', version: '2.0.0' },
        unique_identifier: 'test-plugin:2.0.0',
      })
    })

    it('handles no new version available', async () => {
      const mockReleases = [
        {
          tag: 'v1.0.0',
          assets: [{ downloadUrl: 'https://github.com/test/v1.difypkg' }],
        },
      ]

      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ releases: mockReleases }),
      })

      const releases = await fetchReleases('test-org', 'test-repo')
      const { needUpdate, toastProps } = checkForUpdates(releases, 'v1.0.0')

      expect(needUpdate).toBe(false)
      expect(toastProps.type).toBe('info')
      expect(toastProps.message).toBe('No new version available')
    })

    it('handles empty releases', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ releases: [] }),
      })

      const releases = await fetchReleases('test-org', 'test-repo')
      expect(releases).toHaveLength(0)

      const { needUpdate, toastProps } = checkForUpdates(releases, 'v1.0.0')
      expect(needUpdate).toBe(false)
      expect(toastProps.type).toBe('error')
      expect(toastProps.message).toBe('Input releases is empty')
    })

    it('handles fetch failure gracefully', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
      })

      const releases = await fetchReleases('nonexistent-org', 'nonexistent-repo')

      expect(releases).toEqual([])
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('handles upload failure gracefully', async () => {
      mockUploadGitHub.mockRejectedValue(new Error('Upload failed'))

      const onSuccess = vi.fn()

      await expect(
        handleUpload('https://github.com/test/repo', 'v1.0.0', 'plugin.difypkg', onSuccess),
      ).rejects.toThrow('Upload failed')

      expect(onSuccess).not.toHaveBeenCalled()
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Error uploading package' }),
      )
    })
  })

  describe('Task Status Polling Integration', () => {
    it('polls until plugin installation succeeds', async () => {
      const mockCheckTaskStatus = vi.fn()
        .mockResolvedValueOnce({
          task: {
            plugins: [{ plugin_unique_identifier: 'test:1.0.0', status: 'running' }],
          },
        })
        .mockResolvedValueOnce({
          task: {
            plugins: [{ plugin_unique_identifier: 'test:1.0.0', status: 'success' }],
          },
        })

      const { checkTaskStatus: fetchCheckTaskStatus } = await import('@/service/plugins')
      ;(fetchCheckTaskStatus as ReturnType<typeof vi.fn>).mockImplementation(mockCheckTaskStatus)

      await vi.doMock('@/utils', () => ({
        sleep: () => Promise.resolve(),
      }))

      const { default: checkTaskStatus } = await import(
        '@/app/components/plugins/install-plugin/base/check-task-status',
      )

      const checker = checkTaskStatus()
      const result = await checker.check({
        taskId: 'task-123',
        pluginUniqueIdentifier: 'test:1.0.0',
      })

      expect(result.status).toBe('success')
    })

    it('returns failure when plugin not found in task', async () => {
      const mockCheckTaskStatus = vi.fn().mockResolvedValue({
        task: {
          plugins: [{ plugin_unique_identifier: 'other:1.0.0', status: 'success' }],
        },
      })

      const { checkTaskStatus: fetchCheckTaskStatus } = await import('@/service/plugins')
      ;(fetchCheckTaskStatus as ReturnType<typeof vi.fn>).mockImplementation(mockCheckTaskStatus)

      const { default: checkTaskStatus } = await import(
        '@/app/components/plugins/install-plugin/base/check-task-status',
      )

      const checker = checkTaskStatus()
      const result = await checker.check({
        taskId: 'task-123',
        pluginUniqueIdentifier: 'test:1.0.0',
      })

      expect(result.status).toBe('failed')
      expect(result.error).toBe('Plugin package not found')
    })

    it('stops polling when stop() is called', async () => {
      const { default: checkTaskStatus } = await import(
        '@/app/components/plugins/install-plugin/base/check-task-status',
      )

      const checker = checkTaskStatus()
      checker.stop()

      const result = await checker.check({
        taskId: 'task-123',
        pluginUniqueIdentifier: 'test:1.0.0',
      })

      expect(result.status).toBe('success')
    })
  })
})
