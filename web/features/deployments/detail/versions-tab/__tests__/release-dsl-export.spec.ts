import type { Release } from '@dify/contracts/enterprise/types.gen'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from '@/service/base'
import { downloadBlob } from '@/utils/download'
import { exportReleaseDsl, releaseDslFileName } from '../release-dsl-export'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
}))

const mockGet = vi.mocked(get)
const mockDownloadBlob = vi.mocked(downloadBlob)

function release(overrides: Partial<Release> = {}): Release & { id: string } {
  return {
    id: 'release-1',
    name: 'Release 1',
    ...overrides,
  }
}

describe('release DSL export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The raw DSL export endpoint is skipped from generated contracts, so this helper owns the download request shape.
  describe('Download request', () => {
    it('should download the release DSL from the raw export endpoint', async () => {
      // Arrange
      const data = new Blob(['app:\n  name: test\n'], { type: 'application/x-yaml' })
      mockGet.mockResolvedValue({
        blob: () => Promise.resolve(data),
      } as Response)

      // Act
      await exportReleaseDsl({
        release: release({ id: 'release/id', name: 'Release: 1' }),
        appInstanceName: 'Project/Test',
      })

      // Assert
      expect(mockGet).toHaveBeenCalledWith(
        'enterprise/app-deploy/releases/release%2Fid/dsl',
        {},
        { needAllResponseContent: true, silent: true },
      )
      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data,
        fileName: 'Project-Test-Release-1.yaml',
      })
    })
  })

  // Exported filenames should combine the project and release labels while staying browser-safe.
  describe('File names', () => {
    it('should remove duplicated YAML extensions from the release label', () => {
      expect(releaseDslFileName({
        release: release({ name: 'prod.yml' }),
        appInstanceName: 'Project',
      })).toBe('Project-prod.yaml')
    })

    it('should fall back to release id when the release name is empty', () => {
      expect(releaseDslFileName({
        release: release({ name: '' }),
      })).toBe('release-1.yaml')
    })
  })
})
