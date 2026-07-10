import type {
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

export const isReRankModelSelected = ({
  retrievalConfig,
  rerankModelList,
  indexMethod,
}: {
  retrievalConfig: RetrievalConfig
  rerankModelList: Model[]
  indexMethod?: string
}) => {
  const rerankModelSelected = (() => {
    if (retrievalConfig.reranking_model?.reranking_model_name) {
      const provider = rerankModelList.find(({ provider }) => provider === retrievalConfig.reranking_model?.reranking_provider_name)

      return provider?.models.find(({ model }) => model === retrievalConfig.reranking_model?.reranking_model_name)
    }

    return false
  })()

  if (
    indexMethod === 'high_quality'
    && ([RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText].includes(retrievalConfig.search_method))
    && retrievalConfig.reranking_enable
    && !rerankModelSelected
  ) {
    return false
  }

  if (
    indexMethod === 'high_quality'
    && (retrievalConfig.search_method === RETRIEVE_METHOD.hybrid && retrievalConfig.reranking_mode !== RerankingModeEnum.WeightedScore)
    && !rerankModelSelected
  ) {
    return false
  }

  return true
}
