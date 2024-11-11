import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'
import type {
  DefaultModelResponse,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { RerankingModeEnum } from '@/models/datasets'

export const isReRankModelSelected = ({
  rerankDefaultModel,
  isRerankDefaultModelValid,
  retrievalConfig,
  rerankModelList,
  indexMethod,
}: {
  rerankDefaultModel?: DefaultModelResponse
  isRerankDefaultModelValid: boolean
  retrievalConfig: RetrievalConfig
  rerankModelList: Model[]
  indexMethod?: string
}) => {
  const rerankModelSelected = (() => {
    if (retrievalConfig.reranking_model?.reranking_model_name) {
      const provider = rerankModelList.find(({ provider }) => provider === retrievalConfig.reranking_model?.reranking_provider_name)

      return provider?.models.find(({ model }) => model === retrievalConfig.reranking_model?.reranking_model_name)
    }

    if (isRerankDefaultModelValid)
      return !!rerankDefaultModel

    return false
  })()

  if (
    indexMethod === 'high_quality'
    && (retrievalConfig.search_method === RETRIEVE_METHOD.hybrid && retrievalConfig.reranking_mode !== RerankingModeEnum.WeightedScore)
    && !rerankModelSelected
  )
    return false

  return true
}

export const ensureRerankModelSelected = ({
  rerankDefaultModel,
  indexMethod,
  retrievalConfig,
}: {
  rerankDefaultModel: DefaultModelResponse
  retrievalConfig: RetrievalConfig
  indexMethod?: string
}) => {
  const rerankModel = retrievalConfig.reranking_model?.reranking_model_name ? retrievalConfig.reranking_model : undefined
  if (
    indexMethod === 'high_quality'
    && (retrievalConfig.reranking_enable || retrievalConfig.search_method === RETRIEVE_METHOD.hybrid)
    && !rerankModel
    && rerankDefaultModel
  ) {
    return {
      ...retrievalConfig,
      reranking_model: {
        reranking_provider_name: rerankDefaultModel.provider.provider,
        reranking_model_name: rerankDefaultModel.model,
      },
    }
  }
  return retrievalConfig
}
