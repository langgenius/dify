import type { DefaultModel, Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ConfigurationMethodEnum, ModelFeatureEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { IndexingType } from '../../create/step-two'
import { checkShowMultiModalTip } from './index'

describe('checkShowMultiModalTip', () => {
  // Helper to create a model item with specific features
  const createModelItem = (model: string, features: ModelFeatureEnum[] = []): ModelItem => ({
    model,
    label: { en_US: model, zh_Hans: model },
    model_type: ModelTypeEnum.textEmbedding,
    features,
    fetch_from: ConfigurationMethodEnum.predefinedModel,
    status: ModelStatusEnum.active,
    model_properties: {},
    load_balancing_enabled: false,
    deprecated: false,
  })

  // Helper to create a model provider
  const createModelProvider = (provider: string, models: ModelItem[]): Model => ({
    provider,
    label: { en_US: provider, zh_Hans: provider },
    icon_small: { en_US: '', zh_Hans: '' },
    status: ModelStatusEnum.active,
    models,
  })

  const defaultProps = {
    embeddingModel: {
      provider: 'openai',
      model: 'text-embedding-ada-002',
    } as DefaultModel,
    rerankingEnable: true,
    rerankModel: {
      rerankingProviderName: 'cohere',
      rerankingModelName: 'rerank-english-v2.0',
    },
    indexMethod: IndexingType.QUALIFIED,
    embeddingModelList: [
      createModelProvider('openai', [
        createModelItem('text-embedding-ada-002', [ModelFeatureEnum.vision]),
      ]),
    ],
    rerankModelList: [
      createModelProvider('cohere', [
        createModelItem('rerank-english-v2.0', []),
      ]),
    ],
  }

  describe('Return false conditions', () => {
    it('should return false when indexMethod is not QUALIFIED', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        indexMethod: IndexingType.ECONOMICAL,
      })
      expect(result).toBe(false)
    })

    it('should return false when indexMethod is undefined', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        indexMethod: undefined,
      })
      expect(result).toBe(false)
    })

    it('should return false when embeddingModel.provider is empty', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModel: { provider: '', model: 'text-embedding-ada-002' },
      })
      expect(result).toBe(false)
    })

    it('should return false when embeddingModel.model is empty', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModel: { provider: 'openai', model: '' },
      })
      expect(result).toBe(false)
    })

    it('should return false when embedding model provider is not found', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModel: { provider: 'unknown-provider', model: 'text-embedding-ada-002' },
      })
      expect(result).toBe(false)
    })

    it('should return false when embedding model is not found in provider', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModel: { provider: 'openai', model: 'unknown-model' },
      })
      expect(result).toBe(false)
    })

    it('should return false when embedding model does not support vision', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [
          createModelProvider('openai', [
            createModelItem('text-embedding-ada-002', []), // No vision feature
          ]),
        ],
      })
      expect(result).toBe(false)
    })

    it('should return false when rerankingEnable is false', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankingEnable: false,
      })
      expect(result).toBe(false)
    })

    it('should return false when rerankingModelName is empty', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModel: {
          rerankingProviderName: 'cohere',
          rerankingModelName: '',
        },
      })
      expect(result).toBe(false)
    })

    it('should return false when rerankingProviderName is empty', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModel: {
          rerankingProviderName: '',
          rerankingModelName: 'rerank-english-v2.0',
        },
      })
      expect(result).toBe(false)
    })

    it('should return false when reranking model provider is not found', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModel: {
          rerankingProviderName: 'unknown-provider',
          rerankingModelName: 'rerank-english-v2.0',
        },
      })
      expect(result).toBe(false)
    })

    it('should return false when reranking model is not found in provider', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModel: {
          rerankingProviderName: 'cohere',
          rerankingModelName: 'unknown-model',
        },
      })
      expect(result).toBe(false)
    })

    it('should return false when reranking model supports vision', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModelList: [
          createModelProvider('cohere', [
            createModelItem('rerank-english-v2.0', [ModelFeatureEnum.vision]), // Has vision feature
          ]),
        ],
      })
      expect(result).toBe(false)
    })
  })

  describe('Return true condition', () => {
    it('should return true when embedding model supports vision but reranking model does not', () => {
      const result = checkShowMultiModalTip(defaultProps)
      expect(result).toBe(true)
    })

    it('should return true with different providers', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModel: { provider: 'azure', model: 'azure-embedding' },
        rerankModel: {
          rerankingProviderName: 'jina',
          rerankingModelName: 'jina-reranker',
        },
        embeddingModelList: [
          createModelProvider('azure', [
            createModelItem('azure-embedding', [ModelFeatureEnum.vision]),
          ]),
        ],
        rerankModelList: [
          createModelProvider('jina', [
            createModelItem('jina-reranker', []),
          ]),
        ],
      })
      expect(result).toBe(true)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty embeddingModelList', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [],
      })
      expect(result).toBe(false)
    })

    it('should handle empty rerankModelList', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        rerankModelList: [],
      })
      expect(result).toBe(false)
    })

    it('should handle model with undefined features', () => {
      const modelItem: ModelItem = {
        model: 'test-model',
        label: { en_US: 'test', zh_Hans: 'test' },
        model_type: ModelTypeEnum.textEmbedding,
        features: undefined as unknown as ModelFeatureEnum[],
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status: ModelStatusEnum.active,
        model_properties: {},
        load_balancing_enabled: false,
        deprecated: false,
      }

      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [
          createModelProvider('openai', [modelItem]),
        ],
      })
      expect(result).toBe(false)
    })

    it('should handle model with null features', () => {
      const modelItem: ModelItem = {
        model: 'text-embedding-ada-002',
        label: { en_US: 'test', zh_Hans: 'test' },
        model_type: ModelTypeEnum.textEmbedding,
        features: null as unknown as ModelFeatureEnum[],
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status: ModelStatusEnum.active,
        model_properties: {},
        load_balancing_enabled: false,
        deprecated: false,
      }

      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [
          createModelProvider('openai', [modelItem]),
        ],
      })
      expect(result).toBe(false)
    })

    it('should handle multiple models in provider', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [
          createModelProvider('openai', [
            createModelItem('text-embedding-1', []),
            createModelItem('text-embedding-ada-002', [ModelFeatureEnum.vision]),
            createModelItem('text-embedding-3', []),
          ]),
        ],
      })
      expect(result).toBe(true)
    })

    it('should handle multiple providers in list', () => {
      const result = checkShowMultiModalTip({
        ...defaultProps,
        embeddingModelList: [
          createModelProvider('azure', [
            createModelItem('azure-model', []),
          ]),
          createModelProvider('openai', [
            createModelItem('text-embedding-ada-002', [ModelFeatureEnum.vision]),
          ]),
        ],
      })
      expect(result).toBe(true)
    })
  })
})
