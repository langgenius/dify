import type { TFunction } from 'i18next'
import type { KnowledgeBaseNodeType } from './types'
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
  embeddingModelConfigureRequired = 'embedding-model-configure-required',
  embeddingModelApiKeyUnavailable = 'embedding-model-api-key-unavailable',
  embeddingModelCreditsExhausted = 'embedding-model-credits-exhausted',
  embeddingModelDisabled = 'embedding-model-disabled',
  embeddingModelIncompatible = 'embedding-model-incompatible',
  retrievalSettingRequired = 'retrieval-setting-required',
  rerankingModelRequired = 'reranking-model-required',
  rerankingModelInvalid = 'reranking-model-invalid',
}

type KnowledgeBaseValidationIssue = {
  code: KnowledgeBaseValidationIssueCode
}

type KnowledgeBaseValidationPayload = Pick<KnowledgeBaseNodeType, 'chunk_structure' | 'index_chunk_variable_selector' | 'indexing_technique' | 'embedding_model' | 'embedding_model_provider' | '_embeddingModelList' | '_embeddingProviderModelList' | '_rerankModelList'> & {
  retrieval_model?: Pick<KnowledgeBaseNodeType['retrieval_model'], 'search_method' | 'reranking_enable' | 'reranking_model'>
}

const EMBEDDING_ISSUE_CODES = new Set<KnowledgeBaseValidationIssueCode>([
  KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured,
  KnowledgeBaseValidationIssueCode.embeddingModelConfigureRequired,
  KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable,
  KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted,
  KnowledgeBaseValidationIssueCode.embeddingModelDisabled,
  KnowledgeBaseValidationIssueCode.embeddingModelIncompatible,
])

const resolveIssue = (code: KnowledgeBaseValidationIssueCode): KnowledgeBaseValidationIssue => ({
  code,
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
    if (!currentEmbeddingModelProvider)
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelIncompatible)

    const providerExists = hasProviderScopedModelList || currentEmbeddingModelProvider
    return resolveIssue(providerExists
      ? KnowledgeBaseValidationIssueCode.embeddingModelIncompatible
      : KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured)
  }

  switch (currentEmbeddingModel.status) {
    case ModelStatusEnum.active:
      return null
    case ModelStatusEnum.noConfigure:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelConfigureRequired)
    case ModelStatusEnum.credentialRemoved:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable)
    case ModelStatusEnum.quotaExceeded:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted)
    case ModelStatusEnum.disabled:
      return resolveIssue(KnowledgeBaseValidationIssueCode.embeddingModelDisabled)
    case ModelStatusEnum.noPermission:
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

  switch (issue.code) {
    case KnowledgeBaseValidationIssueCode.chunkStructureRequired:
      return t('nodes.knowledgeBase.chunkIsRequired', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.chunksVariableRequired:
      return t('nodes.knowledgeBase.chunksVariableIsRequired', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.indexMethodRequired:
      return t('nodes.knowledgeBase.indexMethodIsRequired', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.embeddingModelNotConfigured:
      return t('nodes.knowledgeBase.embeddingModelNotConfigured', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.embeddingModelConfigureRequired:
      return t('modelProvider.selector.configureRequired', { ns: 'common' })
    case KnowledgeBaseValidationIssueCode.embeddingModelApiKeyUnavailable:
      return t('modelProvider.selector.apiKeyUnavailable', { ns: 'common' })
    case KnowledgeBaseValidationIssueCode.embeddingModelCreditsExhausted:
      return t('modelProvider.selector.creditsExhausted', { ns: 'common' })
    case KnowledgeBaseValidationIssueCode.embeddingModelDisabled:
      return t('modelProvider.selector.disabled', { ns: 'common' })
    case KnowledgeBaseValidationIssueCode.embeddingModelIncompatible:
      return t('modelProvider.selector.incompatible', { ns: 'common' })
    case KnowledgeBaseValidationIssueCode.retrievalSettingRequired:
      return t('nodes.knowledgeBase.retrievalSettingIsRequired', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.rerankingModelRequired:
      return t('nodes.knowledgeBase.rerankingModelIsRequired', { ns: 'workflow' })
    case KnowledgeBaseValidationIssueCode.rerankingModelInvalid:
      return t('nodes.knowledgeBase.rerankingModelIsInvalid', { ns: 'workflow' })
    default:
      return ''
  }
}

export const isKnowledgeBaseEmbeddingIssue = (issue: KnowledgeBaseValidationIssue | null | undefined) => {
  if (!issue)
    return false

  return EMBEDDING_ISSUE_CODES.has(issue.code)
}
