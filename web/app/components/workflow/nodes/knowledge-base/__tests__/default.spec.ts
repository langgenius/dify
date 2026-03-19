import type { KnowledgeBaseNodeType } from '../types'
import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import nodeDefault from '../default'
import { ChunkStructureEnum, IndexMethodEnum, RetrievalSearchMethodEnum } from '../types'

const t = (key: string) => key

const makeEmbeddingModelList = (status: ModelStatusEnum): Model[] => [{
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [{
    model: 'text-embedding-3-large',
    label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
    model_type: ModelTypeEnum.textEmbedding,
    fetch_from: ConfigurationMethodEnum.predefinedModel,
    status,
    model_properties: {},
    load_balancing_enabled: false,
  }],
  status,
}]

const makeEmbeddingProviderModelList = (status: ModelStatusEnum): ModelItem[] => [{
  model: 'text-embedding-3-large',
  label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
  model_type: ModelTypeEnum.textEmbedding,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status,
  model_properties: {},
  load_balancing_enabled: false,
}]

const createPayload = (overrides: Partial<KnowledgeBaseNodeType> = {}): KnowledgeBaseNodeType => ({
  ...nodeDefault.defaultValue,
  index_chunk_variable_selector: ['chunks', 'results'],
  chunk_structure: ChunkStructureEnum.general,
  indexing_technique: IndexMethodEnum.QUALIFIED,
  embedding_model: 'text-embedding-3-large',
  embedding_model_provider: 'openai',
  retrieval_model: {
    ...nodeDefault.defaultValue.retrieval_model,
    search_method: RetrievalSearchMethodEnum.semantic,
  },
  _embeddingModelList: makeEmbeddingModelList(ModelStatusEnum.active),
  _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.active),
  _rerankModelList: [],
  ...overrides,
}) as KnowledgeBaseNodeType

describe('knowledge-base default node validation', () => {
  it('should return an invalid result when the payload has a validation issue', () => {
    const result = nodeDefault.checkValid(createPayload({ chunk_structure: undefined }), t)

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'nodes.knowledgeBase.chunkIsRequired',
    })
  })

  it('should return a valid result when the payload is complete', () => {
    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })
})
