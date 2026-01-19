import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { useEffect, useMemo, useState } from 'react'
import { checkShowMultiModalTip } from '@/app/components/datasets/settings/utils'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useModelList, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { RETRIEVE_METHOD } from '@/types/app'

export enum IndexingType {
  QUALIFIED = 'high_quality',
  ECONOMICAL = 'economy',
}

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

export type UseIndexingConfigOptions = {
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
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  // Embedding model list
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: defaultEmbeddingModel } = useDefaultModel(ModelTypeEnum.textEmbedding)

  // Index type state
  const [indexType, setIndexType] = useState<IndexingType>(() => {
    if (initialIndexType)
      return initialIndexType
    return isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL
  })

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
    if (initialRetrievalConfig)
      return

    setRetrievalConfig({
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: !!isRerankDefaultModelValid,
      reranking_model: {
        reranking_provider_name: isRerankDefaultModelValid ? rerankDefaultModel?.provider.provider ?? '' : '',
        reranking_model_name: isRerankDefaultModelValid ? rerankDefaultModel?.model ?? '' : '',
      },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    })
  }, [rerankDefaultModel, isRerankDefaultModelValid, initialRetrievalConfig])

  // Sync index type with props
  useEffect(() => {
    if (initialIndexType)
      setIndexType(initialIndexType)
    else
      setIndexType(isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL)
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

export type IndexingConfig = ReturnType<typeof useIndexingConfig>
