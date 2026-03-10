import type { TFunction } from 'i18next'
import type { KnowledgeBaseNodeType } from './types'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import {
  IndexingType,
} from '@/app/components/datasets/create/step-two'
import {
  ModelStatusEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  RetrievalSearchMethodEnum,
} from './types'

export const isHighQualitySearchMethod = (searchMethod: RetrievalSearchMethodEnum) => {
  return searchMethod === RetrievalSearchMethodEnum.semantic
    || searchMethod === RetrievalSearchMethodEnum.hybrid
    || searchMethod === RetrievalSearchMethodEnum.fullText
}

export enum KnowledgeBaseValidationIssueCode {
  chunkStructureRequired = 'chunk-structure-required',
  chunksVariableRequired = 'chunks-variable-required',
  indexMethodRequired = 'index-method-required',
  embeddingModelNotConfigured = 'embedding-model-not-configured',
  embeddingModelApiKeyUnavailable = 'embedding-model-api-key-unavailable',
  embeddingModelCreditsExhausted = 'embedding-model-credits-exhausted',
  embeddingModelIncompatible = 'embedding-model-incompatible',
  retrievalSettingRequired = 'retrieval-setting-required',
  rerankingModelRequired = 'reranking-model-required',
  rerankingModelInvalid = 'reranking-model-invalid',
}

type KnowledgeBaseValidationIssue = {
  code: KnowledgeBaseValidationIssueCode
  i18nKey: I18nKeysWithPrefix<'workflow', 'nodes.knowledgeBase.'>
}

type KnowledgeBaseValidationPayload = Pick<KnowledgeBaseNodeType, 'chunk_structure' | 'index_chunk_variable_selector' | 'indexing_technique' | 'embedding_model' | 'embedding_model_provider' | '_embeddingModelList' | '_embeddingProviderModelList' | '_rerankModelList'> & {
  retrieval_model?: Pick<KnowledgeBaseNodeType['retrieval_model'], 'search_method' | 'reranking_enable' | 'reranking_model'>
}

const ISSUE_I18N_KEY_MAP = {
  [KnowledgeBaseValidationIssueCode.chunkStructureRequired]: 'nodes.knowledgeBase.chunkIsRequired',
  [KnowledgeBaseValidationIssueCode.chunksVariableRequired]: 'nodes.knowledgeBase.chunksVariableIsRequired',
  [KnowledgeBaseValidationIssueCode.indexMethodRequired]: 'nodes.knowledgeBase.indexMethodIsRequired',
  [KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured]: 'nodes.knowledgeBase.embeddingModelNotConfigured',
  [KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable]: 'nodes.knowledgeBase.embeddingModelApiKeyUnavailable',
  [KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted]: 'nodes.knowledgeBase.embeddingModelCreditsExhausted',
  [KnowledgeBaseValidationIssueCode.embeddingModelIncompatible]: 'nodes.knowledgeBase.embeddingModelIncompatible',
  [KnowledgeBaseValidationIssueCode.retrievalSettingRequired]: 'nodes.knowledgeBase.retrievalSettingIsRequired',
  [KnowledgeBaseValidationIssueCode.rerankingModelRequired]: 'nodes.knowledgeBase.rerankingModelIsRequired',
  [KnowledgeBaseValidationIssueCode.rerankingModelInvalid]: 'nodes.knowledgeBase.rerankingModelIsInvalid',
} as const satisfies Record<KnowledgeBaseValidationIssueCode, I18nKeysWithPrefix<'workflow', 'nodes.knowledgeBase.'>>

const EMBEDDING_ISSUE_CODES = new Set<KnowledgeBaseValidationIssueCode>([
  KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured,
  KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable,
  KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted,
  KnowledgeBaseValidationIssueCode.embeddingModelIncompatible,
])

const resolveIssue = (code: KnowledgeBaseValidationIssueCode): KnowledgeBaseValidationIssue => ({
  code,
  i18nKey: ISSUE_I18N_KEY_MAP[code],
})

const resolveEmbeddingIssue = (payload: KnowledgeBaseValidationPayload): KnowledgeBaseValidationIssue | null => {
  const {
    embedding_model,
    embedding_model_provider,
    _embeddingModelList,
    _embeddingProviderModelList,
  } = payload

  if (!embedding_model || !embedding_model_provider)
    return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured)

  const currentEmbeddingModelProvider = _embeddingModelList?.find(provider => provider.provider === embedding_model_provider)
  const hasProviderScopedModelList = !!_embeddingProviderModelList && _embeddingProviderModelList.length > 0
  const embeddingModelCandidates = hasProviderScopedModelList
    ? _embeddingProviderModelList
    : currentEmbeddingModelProvider?.models
  const currentEmbeddingModel = embeddingModelCandidates?.find(model => model.model === embedding_model)

  if (!currentEmbeddingModel) {
    const providerExists = hasProviderScopedModelList || currentEmbeddingModelProvider
    return resolveIssue(providerExists
      ? KnowledgeBaseValidationIssueCode.embeddingModelIncompatible
      : KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured)
  }

  switch (currentEmbeddingModel.status) {
    case ModelStatusEnum.active:
      return null
    case ModelStatusEnum.noConfigure:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured)
    case ModelStatusEnum.credentialRemoved:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable)
    case ModelStatusEnum.quotaExceeded:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted)
    case ModelStatusEnum.noPermission:
    case ModelStatusEnum.disabled:
    default:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelIncompatible)
  }
}

export const getKnowledgeBaseValidationIssue = (payload: KnowledgeBaseValidationPayload): KnowledgeBaseValidationIssue | null => {
  const {
    chunk_structure,
    indexing_technique,
    retrieval_model,
    index_chunk_variable_selector,
    _rerankModelList,
  } = payload

  const {
    search_method,
    reranking_enable,
    reranking_model,
  } = retrieval_model || {}

  if (!chunk_structure)
    return resolveIssue(KnowledgeBaseValidationIssueCode.chunkStructureRequired)

  if (index_chunk_variable_selector.length === 0)
    return resolveIssue(KnowledgeBaseValidationIssueCode.chunksVariableRequired)

  if (!indexing_technique)
    return resolveIssue(KnowledgeBaseValidationIssueCode.indexMethodRequired)

  if (indexing_technique === IndexingType.QUALIFIED) {
    const embeddingIssue = resolveEmbeddingIssue(payload)
    if (embeddingIssue)
      return embeddingIssue
  }

  if (!retrieval_model || !search_method)
    return resolveIssue(KnowledgeBaseValidationIssueCode.retrievalSettingRequired)

  if (reranking_enable) {
    if (!reranking_model || !reranking_model.reranking_provider_name || !reranking_model.reranking_model_name)
      return resolveIssue(KnowledgeBaseValidationIssueCode.rerankingModelRequired)

    const currentRerankingModelProvider = _rerankModelList?.find(provider => provider.provider === reranking_model.reranking_provider_name)
    const currentRerankingModel = currentRerankingModelProvider?.models.find(model => model.model === reranking_model.reranking_model_name)
    if (!currentRerankingModel)
      return resolveIssue(KnowledgeBaseValidationIssueCode.rerankingModelInvalid)
  }

  return null
}

export const getKnowledgeBaseValidationMessage = (
  issue: KnowledgeBaseValidationIssue | null | undefined,
  t: TFunction,
) => {
  if (!issue)
    return ''

  return t(issue.i18nKey, { ns: 'workflow' })
}

export const isKnowledgeBaseEmbeddingIssue = (issue: KnowledgeBaseValidationIssue | null | undefined) => {
  if (!issue)
    return false

  return EMBEDDING_ISSUE_CODES.has(issue.code)
}
