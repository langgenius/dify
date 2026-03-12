import type { KnowledgeBaseNodeType } from './types'
import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from './types'
import {
  getKnowledgeBaseValidationIssue,
  KnowledgeBaseValidationIssueCode,
} from './utils'

const makeEmbeddingModelList = (status: ModelStatusEnum): Model[] => {
  return [
    {
      provider: 'openai',
      icon_small: { en_US: '', zh_Hans: '' },
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
      models: [{
        model: 'gpt-4o',
        label: { en_US: 'GPT-4o', zh_Hans: 'GPT-4o' },
        model_type: ModelTypeEnum.textEmbedding,
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status,
        model_properties: {},
        load_balancing_enabled: false,
      }],
      status,
    },
  ]
}

const makeEmbeddingProviderModelList = (status: ModelStatusEnum): ModelItem[] => {
  return [{
    model: 'gpt-4o',
    label: { en_US: 'GPT-4o', zh_Hans: 'GPT-4o' },
    model_type: ModelTypeEnum.textEmbedding,
    fetch_from: ConfigurationMethodEnum.predefinedModel,
    status,
    model_properties: {},
    load_balancing_enabled: false,
  }]
}

const makePayload = (overrides: Partial<KnowledgeBaseNodeType> = {}): KnowledgeBaseNodeType => {
  return {
    index_chunk_variable_selector: ['general_chunks', 'results'],
    chunk_structure: ChunkStructureEnum.general,
    indexing_technique: IndexMethodEnum.QUALIFIED,
    embedding_model: 'gpt-4o',
    embedding_model_provider: 'openai',
    keyword_number: 10,
    retrieval_model: {
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
      search_method: RetrievalSearchMethodEnum.semantic,
    },
    _embeddingModelList: makeEmbeddingModelList(ModelStatusEnum.active),
    _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.active),
    _rerankModelList: [],
    ...overrides,
  } as KnowledgeBaseNodeType
}

describe('knowledge-base validation issue', () => {
  it('returns chunk structure issue when chunk structure is missing', () => {
    const issue = getKnowledgeBaseValidationIssue(makePayload({ chunk_structure: undefined }))
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.chunkStructureRequired)
  })

  it('returns chunks variable issue when chunks selector is empty', () => {
    const issue = getKnowledgeBaseValidationIssue(makePayload({ index_chunk_variable_selector: [] }))
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.chunksVariableRequired)
  })

  it('maps no-configure to configure required', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.noConfigure) }),
    )
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelConfigureRequired)
  })

  it('maps credential-removed to API key unavailable', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.credentialRemoved) }),
    )
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable)
  })

  it('maps quota-exceeded to credits exhausted', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.quotaExceeded) }),
    )
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted)
  })

  it('maps disabled to disabled', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.disabled) }),
    )
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelDisabled)
  })

  it('maps missing provider plugin to incompatible when embedding model is already configured', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({
        embedding_model_provider: 'missing-provider',
        _embeddingProviderModelList: undefined,
      }),
    )
    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelIncompatible)
  })

  it('falls back to provider model list when provider scoped model list is empty', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: [] }),
    )
    expect(issue).toBeNull()
  })
})
