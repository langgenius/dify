import type { DefaultModelResponse, Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { describe, expect, it } from 'vitest'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { ensureRerankModelSelected, isReRankModelSelected } from './check-rerank-model'

// Test data factory
const createRetrievalConfig = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 3,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  ...overrides,
})

const createModelItem = (model: string): ModelItem => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.rerank,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
})

const createRerankModelList = (): Model[] => [
  {
    provider: 'openai',
    icon_small: { en_US: '', zh_Hans: '' },
    label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
    models: [
      createModelItem('gpt-4-turbo'),
      createModelItem('gpt-3.5-turbo'),
    ],
    status: ModelStatusEnum.active,
  },
  {
    provider: 'cohere',
    icon_small: { en_US: '', zh_Hans: '' },
    label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
    models: [
      createModelItem('rerank-english-v2.0'),
      createModelItem('rerank-multilingual-v2.0'),
    ],
    status: ModelStatusEnum.active,
  },
]

const createDefaultRerankModel = (): DefaultModelResponse => ({
  model: 'rerank-english-v2.0',
  model_type: ModelTypeEnum.rerank,
  provider: {
    provider: 'cohere',
    icon_small: { en_US: '', zh_Hans: '' },
  },
})

describe('check-rerank-model', () => {
  describe('isReRankModelSelected', () => {
    describe('Core Functionality', () => {
      it('should return true when reranking is disabled', () => {
        const config = createRetrievalConfig({
          reranking_enable: false,
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(true)
      })

      it('should return true for economy indexMethod', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'economy',
        })

        expect(result).toBe(true)
      })

      it('should return true when model is selected and valid', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-english-v2.0',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(true)
      })
    })

    describe('Edge Cases', () => {
      it('should return false when reranking enabled but no model selected for semantic search', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(false)
      })

      it('should return false when reranking enabled but no model selected for fullText search', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(false)
      })

      it('should return false for hybrid search without WeightedScore mode and no model selected', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(false)
      })

      it('should return true for hybrid search with WeightedScore mode even without model', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.WeightedScore,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(true)
      })

      it('should return false when provider exists but model not found', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'non-existent-model',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(false)
      })

      it('should return false when provider not found in list', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'non-existent-provider',
            reranking_model_name: 'some-model',
          },
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: 'high_quality',
        })

        expect(result).toBe(false)
      })

      it('should return true with empty rerankModelList when reranking disabled', () => {
        const config = createRetrievalConfig({
          reranking_enable: false,
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: [],
          indexMethod: 'high_quality',
        })

        expect(result).toBe(true)
      })

      it('should return true when indexMethod is undefined', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
        })

        const result = isReRankModelSelected({
          retrievalConfig: config,
          rerankModelList: createRerankModelList(),
          indexMethod: undefined,
        })

        expect(result).toBe(true)
      })
    })
  })

  describe('ensureRerankModelSelected', () => {
    describe('Core Functionality', () => {
      it('should return original config when reranking model already selected', () => {
        const config = createRetrievalConfig({
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-english-v2.0',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'high_quality',
        })

        expect(result).toEqual(config)
      })

      it('should apply default model when reranking enabled but no model selected', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'high_quality',
        })

        expect(result.reranking_model).toEqual({
          reranking_provider_name: 'cohere',
          reranking_model_name: 'rerank-english-v2.0',
        })
      })

      it('should apply default model for hybrid search method', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: false,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'high_quality',
        })

        expect(result.reranking_model).toEqual({
          reranking_provider_name: 'cohere',
          reranking_model_name: 'rerank-english-v2.0',
        })
      })
    })

    describe('Edge Cases', () => {
      it('should return original config when indexMethod is not high_quality', () => {
        const config = createRetrievalConfig({
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'economy',
        })

        expect(result).toEqual(config)
      })

      it('should return original config when rerankDefaultModel is null', () => {
        const config = createRetrievalConfig({
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: null as unknown as DefaultModelResponse,
          indexMethod: 'high_quality',
        })

        expect(result).toEqual(config)
      })

      it('should return original config when reranking disabled and not hybrid search', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: false,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'high_quality',
        })

        expect(result).toEqual(config)
      })

      it('should return original config when indexMethod is undefined', () => {
        const config = createRetrievalConfig({
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: undefined,
        })

        expect(result).toEqual(config)
      })

      it('should preserve other config properties when applying default model', () => {
        const config = createRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
          top_k: 10,
          score_threshold_enabled: true,
          score_threshold: 0.8,
        })

        const result = ensureRerankModelSelected({
          retrievalConfig: config,
          rerankDefaultModel: createDefaultRerankModel(),
          indexMethod: 'high_quality',
        })

        expect(result.top_k).toBe(10)
        expect(result.score_threshold_enabled).toBe(true)
        expect(result.score_threshold).toBe(0.8)
        expect(result.search_method).toBe(RETRIEVE_METHOD.semantic)
      })
    })
  })
})
