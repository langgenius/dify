import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { checkShowMultiModalTip } from '@/app/components/datasets/settings/utils'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { RETRIEVE_METHOD } from '@/types/app'

export const IndexingType = {
  QUALIFIED: 'high_quality',
  ECONOMICAL: 'economy',
} as const

export type IndexingType = (typeof IndexingType)[keyof typeof IndexingType]

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 3,
  score_threshold_enabled: false,
  score_threshold: 0.5,
}

type UseIndexingConfigOptions = {
  initialIndexType?: IndexingType
  initialEmbeddingModel?: DefaultModel
  initialRetrievalConfig?: RetrievalConfig
  isAPIKeySet: boolean
  hasSetIndexType: boolean
}

export const useIndexingConfig = (options: UseIndexingConfigOptions) => {
  const {
    initialIndexType,
    initialEmbeddingModel,
    initialRetrievalConfig,
    isAPIKeySet,
    hasSetIndexType,
  } = options

  // Rerank model
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
    loadQueries: rerankLoadQueries,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  // Index type state
  const [indexType, setIndexType] = useState<IndexingType>(() => {
    if (initialIndexType) return initialIndexType
    return isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL
  })

  // Embedding model list
  const embeddingModelListQuery = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textEmbedding } },
      select: (response) => response.data,
    }),
  )
  const { data: embeddingModelList = [] } = embeddingModelListQuery
  // The only caller renders these load errors, so claiming them here keeps them off the toasts.
  // A failed first load leaves no embedding model to pick; a failed refetch keeps the cached list.
  // Both render only in the high-quality settings, so they are claimed only while those show.
  const showsModelSettings = indexType === IndexingType.QUALIFIED
  const embeddingModelListLoad = useOwnedQueryErrors(
    showsModelSettings ? [embeddingModelListQuery] : [],
  )
  const embeddingModelLoadError = embeddingModelListLoad && {
    error: embeddingModelListLoad.error,
    retrying: embeddingModelListLoad.retrying,
    onRetry: embeddingModelListLoad.retry,
  }
  const { data: defaultEmbeddingModel, query: defaultEmbeddingModelQuery } = useDefaultModel(
    ModelTypeEnum.textEmbedding,
  )
  // The rerank models and the default models seed the retrieval and embedding settings; a failed
  // first load would otherwise look like no rerank model and no default to start from.
  const modelDefaultsLoad = useOwnedQueryErrors(
    showsModelSettings ? [...rerankLoadQueries, defaultEmbeddingModelQuery] : [],
  )
  const modelDefaultsLoadError = modelDefaultsLoad && {
    error: modelDefaultsLoad.error,
    retrying: modelDefaultsLoad.retrying,
    onRetry: modelDefaultsLoad.retry,
  }

  // Embedding model state
  const [embeddingModel, setEmbeddingModel] = useState<DefaultModel>(
    initialEmbeddingModel ?? {
      provider: defaultEmbeddingModel?.provider.provider || '',
      model: defaultEmbeddingModel?.model || '',
    },
  )

  // Retrieval config state
  const [retrievalConfig, setRetrievalConfig] = useState<RetrievalConfig>(
    initialRetrievalConfig ?? DEFAULT_RETRIEVAL_CONFIG,
  )

  // Sync retrieval config with rerank model when available
  useEffect(() => {
    if (initialRetrievalConfig) return

    setRetrievalConfig({
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: !!isRerankDefaultModelValid,
      reranking_model: {
        reranking_provider_name: isRerankDefaultModelValid
          ? (rerankDefaultModel?.provider.provider ?? '')
          : '',
        reranking_model_name: isRerankDefaultModelValid ? (rerankDefaultModel?.model ?? '') : '',
      },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    })
  }, [rerankDefaultModel, isRerankDefaultModelValid, initialRetrievalConfig])

  // Sync index type with props
  useEffect(() => {
    if (initialIndexType) setIndexType(initialIndexType)
    else setIndexType(isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL)
  }, [isAPIKeySet, initialIndexType])

  // Show multimodal tip
  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel,
      rerankingEnable: retrievalConfig.reranking_enable,
      rerankModel: {
        rerankingProviderName: retrievalConfig.reranking_model.reranking_provider_name,
        rerankingModelName: retrievalConfig.reranking_model.reranking_model_name,
      },
      indexMethod: indexType,
      embeddingModelList,
      rerankModelList,
    })
  }, [embeddingModel, retrievalConfig, indexType, embeddingModelList, rerankModelList])

  // Get effective indexing technique
  const getIndexingTechnique = () => initialIndexType || indexType

  return {
    // Index type
    indexType,
    setIndexType,
    hasSetIndexType,
    getIndexingTechnique,

    // Embedding model
    embeddingModel,
    setEmbeddingModel,
    embeddingModelList,
    embeddingModelLoadError,
    modelDefaultsLoadError,
    defaultEmbeddingModel,

    // Retrieval config
    retrievalConfig,
    setRetrievalConfig,
    rerankModelList,
    rerankDefaultModel,
    isRerankDefaultModelValid,

    // Computed
    showMultiModalTip,
  }
}
