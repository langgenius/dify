import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RETRIEVE_METHOD } from '@/types/app'

// Hoisted mock state
const mocks = vi.hoisted(() => ({
  rerankModelList: [] as Array<{ provider: { provider: string }, model: string }>,
  rerankDefaultModel: null as { provider: { provider: string }, model: string } | null,
  isRerankDefaultModelValid: null as { provider: { provider: string }, model: string } | null,
  embeddingModelList: [] as Array<{ provider: { provider: string }, model: string }>,
  defaultEmbeddingModel: null as { provider: { provider: string }, model: string } | null,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: mocks.rerankModelList,
    defaultModel: mocks.rerankDefaultModel,
    currentModel: mocks.isRerankDefaultModelValid,
  }),
  useModelList: () => ({ data: mocks.embeddingModelList }),
  useDefaultModel: () => ({ data: mocks.defaultEmbeddingModel }),
}))

vi.mock('@/app/components/datasets/settings/utils', () => ({
  checkShowMultiModalTip: vi.fn(() => false),
}))

const { IndexingType, useIndexingConfig } = await import('../use-indexing-config')

describe('useIndexingConfig', () => {
  const defaultOptions = {
    isAPIKeySet: true,
    hasSetIndexType: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rerankModelList = []
    mocks.rerankDefaultModel = null
    mocks.isRerankDefaultModelValid = null
    mocks.embeddingModelList = []
    mocks.defaultEmbeddingModel = null
  })

  describe('initial state', () => {
    it('should default to QUALIFIED when API key is set', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))
      expect(result.current.indexType).toBe(IndexingType.QUALIFIED)
    })

    it('should default to ECONOMICAL when API key is not set', () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ ...defaultOptions, isAPIKeySet: false }),
      )
      expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
    })

    it('should use initial index type when provided', () => {
      const { result } = renderHook(() =>
        useIndexingConfig({
          ...defaultOptions,
          initialIndexType: IndexingType.ECONOMICAL,
        }),
      )
      expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
    })

    it('should use initial embedding model when provided', () => {
      const { result } = renderHook(() =>
        useIndexingConfig({
          ...defaultOptions,
          initialEmbeddingModel: { provider: 'openai', model: 'text-embedding-3-small' },
        }),
      )
      expect(result.current.embeddingModel).toEqual({
        provider: 'openai',
        model: 'text-embedding-3-small',
      })
    })

    it('should use initial retrieval config when provided', () => {
      const config = {
        search_method: RETRIEVE_METHOD.fullText,
        reranking_enable: false,
        reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
        top_k: 5,
        score_threshold_enabled: true,
        score_threshold: 0.8,
      }
      const { result } = renderHook(() =>
        useIndexingConfig({ ...defaultOptions, initialRetrievalConfig: config }),
      )
      expect(result.current.retrievalConfig.search_method).toBe(RETRIEVE_METHOD.fullText)
      expect(result.current.retrievalConfig.top_k).toBe(5)
    })
  })

  describe('setters', () => {
    it('should update index type', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))

      act(() => {
        result.current.setIndexType(IndexingType.ECONOMICAL)
      })
      expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
    })

    it('should update embedding model', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))

      act(() => {
        result.current.setEmbeddingModel({ provider: 'cohere', model: 'embed-v3' })
      })
      expect(result.current.embeddingModel).toEqual({ provider: 'cohere', model: 'embed-v3' })
    })

    it('should update retrieval config', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))
      const newConfig = {
        ...result.current.retrievalConfig,
        top_k: 10,
      }

      act(() => {
        result.current.setRetrievalConfig(newConfig)
      })
      expect(result.current.retrievalConfig.top_k).toBe(10)
    })
  })

  describe('getIndexingTechnique', () => {
    it('should return initialIndexType when provided', () => {
      const { result } = renderHook(() =>
        useIndexingConfig({
          ...defaultOptions,
          initialIndexType: IndexingType.ECONOMICAL,
        }),
      )
      expect(result.current.getIndexingTechnique()).toBe(IndexingType.ECONOMICAL)
    })

    it('should return current indexType when no initialIndexType', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))
      expect(result.current.getIndexingTechnique()).toBe(IndexingType.QUALIFIED)
    })
  })

  describe('computed properties', () => {
    it('should expose hasSetIndexType from options', () => {
      const { result } = renderHook(() =>
        useIndexingConfig({ ...defaultOptions, hasSetIndexType: true }),
      )
      expect(result.current.hasSetIndexType).toBe(true)
    })

    it('should expose showMultiModalTip as boolean', () => {
      const { result } = renderHook(() => useIndexingConfig(defaultOptions))
      expect(typeof result.current.showMultiModalTip).toBe('boolean')
    })
  })
})
