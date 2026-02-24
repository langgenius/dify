import { renderHook } from '@testing-library/react'
import { useSkillFileData } from './use-skill-file-data'

const { mockUseQuery, mockContentOptions, mockDownloadUrlOptions } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockContentOptions: vi.fn().mockReturnValue({
    queryKey: ['test', 'content'],
    queryFn: vi.fn(),
  }),
  mockDownloadUrlOptions: vi.fn().mockReturnValue({
    queryKey: ['test', 'downloadUrl'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock('@/service/use-app-asset', () => ({
  appAssetFileContentOptions: (...args: unknown[]) => mockContentOptions(...args),
  appAssetFileDownloadUrlOptions: (...args: unknown[]) => mockDownloadUrlOptions(...args),
}))

describe('useSkillFileData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })
  })

  describe('mode control', () => {
    it('should disable both queries when mode is none', () => {
      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'none'))

      expect(mockContentOptions).toHaveBeenCalledWith('app-1', 'node-1')
      expect(mockDownloadUrlOptions).toHaveBeenCalledWith('app-1', 'node-1')
      expect(mockUseQuery.mock.calls[0][0].enabled).toBe(false)
      expect(mockUseQuery.mock.calls[1][0].enabled).toBe(false)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should fetch content data when mode is content', () => {
      const contentError = new Error('content-error')
      mockUseQuery
        .mockReturnValueOnce({
          data: { content: 'hello' },
          isLoading: true,
          error: contentError,
        })
        .mockReturnValueOnce({
          data: { download_url: 'https://example.com/file' },
          isLoading: true,
          error: new Error('download-error'),
        })

      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'content'))

      expect(mockUseQuery.mock.calls[0][0].enabled).toBe(true)
      expect(mockUseQuery.mock.calls[1][0].enabled).toBe(false)
      expect(result.current.fileContent).toEqual({ content: 'hello' })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.error).toBe(contentError)
    })

    it('should disable content query when nodeId is null even if mode is content', () => {
      const { result } = renderHook(() => useSkillFileData('app-1', null, 'content'))

      expect(mockUseQuery.mock.calls[0][0].enabled).toBe(false)
      expect(result.current.isLoading).toBe(false)
    })

    it('should fetch download URL data when mode is download', () => {
      const downloadError = new Error('download-error')
      mockUseQuery
        .mockReturnValueOnce({
          data: { content: 'hello' },
          isLoading: true,
          error: new Error('content-error'),
        })
        .mockReturnValueOnce({
          data: { download_url: 'https://example.com/file' },
          isLoading: true,
          error: downloadError,
        })

      const { result } = renderHook(() => useSkillFileData('app-1', 'node-1', 'download'))

      expect(mockUseQuery.mock.calls[0][0].enabled).toBe(false)
      expect(mockUseQuery.mock.calls[1][0].enabled).toBe(true)
      expect(result.current.downloadUrlData).toEqual({ download_url: 'https://example.com/file' })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.error).toBe(downloadError)
    })
  })
})
