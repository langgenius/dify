import type { CustomFile, FullDocumentDetail, ProcessRule } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  toastNotify: vi.fn(),
  mutateAsync: vi.fn(),
  isReRankModelSelected: vi.fn(() => true),
  trackEvent: vi.fn(),
  invalidDatasetList: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: mocks.toastNotify },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mocks.trackEvent,
}))

vi.mock('@/app/components/datasets/common/check-rerank-model', () => ({
  isReRankModelSelected: mocks.isReRankModelSelected,
}))

vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreateFirstDocument: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  useCreateDocument: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  getNotionInfo: vi.fn(() => []),
  getWebsiteInfo: vi.fn(() => ({})),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mocks.invalidDatasetList,
}))

const { useDocumentCreation } = await import('../use-document-creation')
const { IndexingType } = await import('../use-indexing-config')

describe('useDocumentCreation', () => {
  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    files: [{ id: 'f-1', name: 'test.txt' }] as CustomFile[],
    notionPages: [],
    notionCredentialId: '',
    websitePages: [],
  }

  const defaultValidationParams = {
    segmentationType: 'general',
    maxChunkLength: 1024,
    limitMaxChunkLength: 4000,
    overlap: 50,
    indexType: IndexingType.QUALIFIED,
    embeddingModel: { provider: 'openai', model: 'text-embedding-3-small' },
    rerankModelList: [],
    retrievalConfig: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    } as RetrievalConfig,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isReRankModelSelected.mockReturnValue(true)
  })

  describe('validateParams', () => {
    it('should return true for valid params', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      expect(result.current.validateParams(defaultValidationParams)).toBe(true)
    })

    it('should return false when overlap > maxChunkLength', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      const invalid = { ...defaultValidationParams, overlap: 2000, maxChunkLength: 1000 }
      expect(result.current.validateParams(invalid)).toBe(false)
      expect(mocks.toastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should return false when maxChunkLength > limitMaxChunkLength', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      const invalid = { ...defaultValidationParams, maxChunkLength: 5000, limitMaxChunkLength: 4000 }
      expect(result.current.validateParams(invalid)).toBe(false)
    })

    it('should return false when qualified but no embedding model', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      const invalid = {
        ...defaultValidationParams,
        indexType: IndexingType.QUALIFIED,
        embeddingModel: { provider: '', model: '' },
      }
      expect(result.current.validateParams(invalid)).toBe(false)
    })

    it('should return false when rerank model not selected', () => {
      mocks.isReRankModelSelected.mockReturnValue(false)
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      expect(result.current.validateParams(defaultValidationParams)).toBe(false)
    })

    it('should skip embedding/rerank checks when isSetting is true', () => {
      mocks.isReRankModelSelected.mockReturnValue(false)
      const { result } = renderHook(() =>
        useDocumentCreation({ ...defaultOptions, isSetting: true }),
      )
      const params = {
        ...defaultValidationParams,
        embeddingModel: { provider: '', model: '' },
      }
      expect(result.current.validateParams(params)).toBe(true)
    })
  })

  describe('buildCreationParams', () => {
    it('should build params for FILE data source', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      const processRule = { mode: 'custom', rules: {} } as unknown as ProcessRule
      const retrievalConfig = defaultValidationParams.retrievalConfig
      const embeddingModel = { provider: 'openai', model: 'text-embedding-3-small' }

      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        processRule,
        retrievalConfig,
        embeddingModel,
        'high_quality',
      )

      expect(params).not.toBeNull()
      expect(params!.data_source!.type).toBe(DataSourceType.FILE)
      expect(params!.data_source!.info_list.file_info_list?.file_ids).toContain('f-1')
      expect(params!.embedding_model).toBe('text-embedding-3-small')
      expect(params!.embedding_model_provider).toBe('openai')
    })

    it('should build params for isSetting mode', () => {
      const detail = { id: 'doc-1' } as FullDocumentDetail
      const { result } = renderHook(() =>
        useDocumentCreation({ ...defaultOptions, isSetting: true, documentDetail: detail }),
      )
      const params = result.current.buildCreationParams(
        ChunkingMode.text,
        'English',
        { mode: 'custom', rules: {} } as unknown as ProcessRule,
        defaultValidationParams.retrievalConfig,
        { provider: 'openai', model: 'text-embedding-3-small' },
        'high_quality',
      )

      expect(params!.original_document_id).toBe('doc-1')
      expect(params!.data_source).toBeUndefined()
    })
  })

  describe('validatePreviewParams', () => {
    it('should return true when maxChunkLength is within limit', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      expect(result.current.validatePreviewParams(1024)).toBe(true)
    })

    it('should return false when maxChunkLength exceeds limit', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      expect(result.current.validatePreviewParams(999999)).toBe(false)
      expect(mocks.toastNotify).toHaveBeenCalled()
    })
  })

  describe('isCreating', () => {
    it('should reflect mutation pending state', () => {
      const { result } = renderHook(() => useDocumentCreation(defaultOptions))
      expect(result.current.isCreating).toBe(false)
    })
  })
})
