import type { KnowledgeBaseNodeType } from '../types'
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
} from '../types'
import {
  getKnowledgeBaseValidationIssue,
  getKnowledgeBaseValidationMessage,
  isHighQualitySearchMethod,
  isKnowledgeBaseEmbeddingIssue,
  KnowledgeBaseValidationIssueCode,
} from '../utils'

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
  it('identifies high quality retrieval methods', () => {
    expect(isHighQualitySearchMethod(RetrievalSearchMethodEnum.semantic)).toBe(true)
    expect(isHighQualitySearchMethod(RetrievalSearchMethodEnum.hybrid)).toBe(true)
    expect(isHighQualitySearchMethod(RetrievalSearchMethodEnum.fullText)).toBe(true)
    expect(isHighQualitySearchMethod('unknown-method' as RetrievalSearchMethodEnum)).toBe(false)
  })

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

  it('returns embedding-model-not-configured when the qualified index is missing provider details', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ embedding_model: undefined }),
    )

    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured)
  })

  it('maps no-permission embedding models to incompatible', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ _embeddingProviderModelList: makeEmbeddingProviderModelList(ModelStatusEnum.noPermission) }),
    )

    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.embeddingModelIncompatible)
  })

  it('returns retrieval-setting-required when retrieval search method is missing', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({ retrieval_model: undefined as never }),
    )

    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.retrievalSettingRequired)
  })

  it('returns reranking-model-required when reranking is enabled without a model', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({
        retrieval_model: {
          ...makePayload().retrieval_model,
          reranking_enable: true,
        },
      }),
    )

    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.rerankingModelRequired)
  })

  it('returns reranking-model-invalid when the configured reranking model is unavailable', () => {
    const issue = getKnowledgeBaseValidationIssue(
      makePayload({
        retrieval_model: {
          ...makePayload().retrieval_model,
          reranking_enable: true,
          reranking_model: {
            reranking_provider_name: 'missing-provider',
            reranking_model_name: 'missing-model',
          },
        },
      }),
    )

    expect(issue?.code).toBe(KnowledgeBaseValidationIssueCode.rerankingModelInvalid)
  })
})

describe('knowledge-base validation messaging', () => {
  const t = (key: string) => key

  it.each([
    [KnowledgeBaseValidationIssueCode.chunkStructureRequired, 'nodes.knowledgeBase.chunkIsRequired'],
    [KnowledgeBaseValidationIssueCode.chunksVariableRequired, 'nodes.knowledgeBase.chunksVariableIsRequired'],
    [KnowledgeBaseValidationIssueCode.indexMethodRequired, 'nodes.knowledgeBase.indexMethodIsRequired'],
    [KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured, 'nodes.knowledgeBase.embeddingModelNotConfigured'],
    [KnowledgeBaseValidationIssueCode.embeddingModelConfigureRequired, 'modelProvider.selector.configureRequired'],
    [KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable, 'modelProvider.selector.apiKeyUnavailable'],
    [KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted, 'modelProvider.selector.creditsExhausted'],
    [KnowledgeBaseValidationIssueCode.embeddingModelDisabled, 'modelProvider.selector.disabled'],
    [KnowledgeBaseValidationIssueCode.embeddingModelIncompatible, 'modelProvider.selector.incompatible'],
    [KnowledgeBaseValidationIssueCode.retrievalSettingRequired, 'nodes.knowledgeBase.retrievalSettingIsRequired'],
    [KnowledgeBaseValidationIssueCode.rerankingModelRequired, 'nodes.knowledgeBase.rerankingModelIsRequired'],
    [KnowledgeBaseValidationIssueCode.rerankingModelInvalid, 'nodes.knowledgeBase.rerankingModelIsInvalid'],
  ] as const)('maps %s to the expected translation key', (code, expectedKey) => {
    expect(getKnowledgeBaseValidationMessage({ code }, t as never)).toBe(expectedKey)
  })

  it('returns an empty string when there is no issue', () => {
    expect(getKnowledgeBaseValidationMessage(undefined, t as never)).toBe('')
  })
})

describe('isKnowledgeBaseEmbeddingIssue', () => {
  it('returns true for embedding-related issues', () => {
    expect(isKnowledgeBaseEmbeddingIssue({ code: KnowledgeBaseValidationIssueCode.embeddingModelDisabled })).toBe(true)
  })

  it('returns false for non-embedding issues and missing values', () => {
    expect(isKnowledgeBaseEmbeddingIssue({ code: KnowledgeBaseValidationIssueCode.rerankingModelInvalid })).toBe(false)
    expect(isKnowledgeBaseEmbeddingIssue(undefined)).toBe(false)
  })
})
