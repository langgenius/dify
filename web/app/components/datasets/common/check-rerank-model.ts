import type { BackendModel } from '../../header/account-setting/model-page/declarations'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'

export const isReRankModelSelected = ({
  rerankDefaultModel,
  isRerankDefaultModelVaild,
  retrievalConfig,
  rerankModelList,
  indexMethod,
}: {
  rerankDefaultModel?: BackendModel
  isRerankDefaultModelVaild: boolean
  retrievalConfig: RetrievalConfig
  rerankModelList: BackendModel[]
  indexMethod?: string
}) => {
  const rerankModelSelected = (() => {
    if (retrievalConfig.reranking_model?.reranking_model_name)
      return !!rerankModelList.find(({ model_name }) => model_name === retrievalConfig.reranking_model?.reranking_model_name)

    if (isRerankDefaultModelVaild)
      return !!rerankDefaultModel

    return false
  })()

  if (
    indexMethod === 'high_quality'
    && (retrievalConfig.reranking_enable || retrievalConfig.search_method === RETRIEVE_METHOD.hybrid)
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
  rerankDefaultModel: BackendModel
  retrievalConfig: RetrievalConfig
  indexMethod?: string
}) => {
  const rerankModel = retrievalConfig.reranking_model?.reranking_model_name ? retrievalConfig.reranking_model : undefined
  if (
    indexMethod === 'high_quality'
    && (retrievalConfig.reranking_enable || retrievalConfig.search_method === RETRIEVE_METHOD.hybrid)
    && !rerankModel
  ) {
    return {
      ...retrievalConfig,
      reranking_model: {
        reranking_provider_name: rerankDefaultModel.model_provider.provider_name,
        reranking_model_name: rerankDefaultModel.model_name,
      },
    }
  }
  return retrievalConfig
}
