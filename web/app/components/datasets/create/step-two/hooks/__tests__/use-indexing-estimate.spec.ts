import type { IndexingType } from '../use-indexing-config'
import type { NotionPage } from '@/models/common'
import type { ChunkingMode, CrawlResultItem, CustomFile, ProcessRule } from '@/models/datasets'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  fileMutate: vi.fn(),
  fileReset: vi.fn(),
  notionMutate: vi.fn(),
  notionReset: vi.fn(),
  webMutate: vi.fn(),
  webReset: vi.fn(),
}))

vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useFetchFileIndexingEstimateForFile: () => ({
    mutate: mocks.fileMutate,
    reset: mocks.fileReset,
    data: { tokens: 100, total_segments: 5 },
    isIdle: true,
    isPending: false,
  }),
  useFetchFileIndexingEstimateForNotion: () => ({
    mutate: mocks.notionMutate,
    reset: mocks.notionReset,
    data: null,
    isIdle: true,
    isPending: false,
  }),
  useFetchFileIndexingEstimateForWeb: () => ({
    mutate: mocks.webMutate,
    reset: mocks.webReset,
    data: null,
    isIdle: true,
    isPending: false,
  }),
}))

const { useIndexingEstimate } = await import('../use-indexing-estimate')

describe('useIndexingEstimate', () => {
  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    currentDocForm: 'text_model' as ChunkingMode,
    docLanguage: 'English',
    files: [{ id: 'f-1', name: 'test.txt' }] as unknown as CustomFile[],
    previewNotionPage: {} as unknown as NotionPage,
    notionCredentialId: '',
    previewWebsitePage: {} as unknown as CrawlResultItem,
    indexingTechnique: 'high_quality' as unknown as IndexingType,
    processRule: { mode: 'custom', rules: {} } as unknown as ProcessRule,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('currentMutation selection', () => {
    it('should select file mutation for FILE type', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      expect(result.current.estimate).toEqual({ tokens: 100, total_segments: 5 })
    })

    it('should select notion mutation for NOTION type', () => {
      const { result } = renderHook(() => useIndexingEstimate({
        ...defaultOptions,
        dataSourceType: DataSourceType.NOTION,
      }))
      expect(result.current.estimate).toBeNull()
    })

    it('should select web mutation for WEB type', () => {
      const { result } = renderHook(() => useIndexingEstimate({
        ...defaultOptions,
        dataSourceType: DataSourceType.WEB,
      }))
      expect(result.current.estimate).toBeNull()
    })
  })

  describe('fetchEstimate', () => {
    it('should call file mutate for FILE type', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      result.current.fetchEstimate()
      expect(mocks.fileMutate).toHaveBeenCalledOnce()
    })

    it('should call notion mutate for NOTION type', () => {
      const { result } = renderHook(() => useIndexingEstimate({
        ...defaultOptions,
        dataSourceType: DataSourceType.NOTION,
      }))
      result.current.fetchEstimate()
      expect(mocks.notionMutate).toHaveBeenCalledOnce()
    })

    it('should call web mutate for WEB type', () => {
      const { result } = renderHook(() => useIndexingEstimate({
        ...defaultOptions,
        dataSourceType: DataSourceType.WEB,
      }))
      result.current.fetchEstimate()
      expect(mocks.webMutate).toHaveBeenCalledOnce()
    })
  })

  describe('state properties', () => {
    it('should expose isIdle', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      expect(result.current.isIdle).toBe(true)
    })

    it('should expose isPending', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      expect(result.current.isPending).toBe(false)
    })

    it('should expose reset function', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      result.current.reset()
      expect(mocks.fileReset).toHaveBeenCalledOnce()
    })
  })
})
