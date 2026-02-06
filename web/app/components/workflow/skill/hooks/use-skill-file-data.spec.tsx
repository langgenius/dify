import { renderHook } from '@testing-library/react'
import { useSkillFileData } from './use-skill-file-data'

const {
  mockUseGetAppAssetFileContent,
  mockUseGetAppAssetFileDownloadUrl,
} = vi.hoisted(() => ({
  mockUseGetAppAssetFileContent: vi.fn(),
  mockUseGetAppAssetFileDownloadUrl: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useGetAppAssetFileContent: (...args: unknown[]) => mockUseGetAppAssetFileContent(...args),
  useGetAppAssetFileDownloadUrl: (...args: unknown[]) => mockUseGetAppAssetFileDownloadUrl(...args),
}))

describe('useSkillFileData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetAppAssetFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })
    mockUseGetAppAssetFileDownloadUrl.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })
  })

  describe('mode control', () => {
    it('should disable both queries when mode is none', () => {
      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'none'))

      expect(mockUseGetAppAssetFileContent).toHaveBeenCalledWith('app-1', 'node-1', { enabled: false })
      expect(mockUseGetAppAssetFileDownloadUrl).toHaveBeenCalledWith('app-1', 'node-1', { enabled: false })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should fetch content data when mode is content', () => {
      const contentError = new Error('content-error')
      mockUseGetAppAssetFileContent.mockReturnValue({
        data: { content: 'hello' },
        isLoading: true,
        error: contentError,
      })
      mockUseGetAppAssetFileDownloadUrl.mockReturnValue({
        data: { download_url: 'https://example.com/file' },
        isLoading: true,
        error: new Error('download-error'),
      })

      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'content'))

      expect(mockUseGetAppAssetFileContent).toHaveBeenCalledWith('app-1', 'node-1', { enabled: true })
      expect(mockUseGetAppAssetFileDownloadUrl).toHaveBeenCalledWith('app-1', 'node-1', { enabled: false })
      expect(result.current.fileContent).toEqual({ content: 'hello' })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.error).toBe(contentError)
    })

    it('should fetch download URL data when mode is download', () => {
      const downloadError = new Error('download-error')
      mockUseGetAppAssetFileContent.mockReturnValue({
        data: { content: 'hello' },
        isLoading: true,
        error: new Error('content-error'),
      })
      mockUseGetAppAssetFileDownloadUrl.mockReturnValue({
        data: { download_url: 'https://example.com/file' },
        isLoading: true,
        error: downloadError,
      })

      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'download'))

      expect(mockUseGetAppAssetFileContent).toHaveBeenCalledWith('app-1', 'node-1', { enabled: false })
      expect(mockUseGetAppAssetFileDownloadUrl).toHaveBeenCalledWith('app-1', 'node-1', { enabled: true })
      expect(result.current.downloadUrlData).toEqual({ download_url: 'https://example.com/file' })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.error).toBe(downloadError)
    })
  })
})
