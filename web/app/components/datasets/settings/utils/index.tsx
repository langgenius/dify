import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { IndexingType } from '../../create/step-two'

type ShowMultiModalTipProps = {
  embeddingModel: DefaultModel
  rerankingEnable: boolean
  rerankModel: {
    rerankingProviderName: string
    rerankingModelName: string
  }
  indexMethod: IndexingType | undefined
  embeddingModelList: Model[]
  rerankModelList: Model[]
}

export const checkShowMultiModalTip = ({
  embeddingModel,
  rerankingEnable,
  rerankModel,
  indexMethod,
  embeddingModelList,
  rerankModelList,
}: ShowMultiModalTipProps) => {
  if (indexMethod !== IndexingType.QUALIFIED || !embeddingModel.provider || !embeddingModel.model)
    return false
  const currentEmbeddingModelProvider = embeddingModelList.find(model => model.provider === embeddingModel.provider)
  if (!currentEmbeddingModelProvider)
    return false
  const currentEmbeddingModel = currentEmbeddingModelProvider.models.find(model => model.model === embeddingModel.model)
  if (!currentEmbeddingModel)
    return false
  const isCurrentEmbeddingModelSupportMultiModal = !!currentEmbeddingModel.features?.includes(ModelFeatureEnum.vision)
  if (!isCurrentEmbeddingModelSupportMultiModal)
    return false
  const { rerankingModelName, rerankingProviderName } = rerankModel
  if (!rerankingEnable || !rerankingModelName || !rerankingProviderName)
    return false
  const currentRerankingModelProvider = rerankModelList.find(model => model.provider === rerankingProviderName)
  if (!currentRerankingModelProvider)
    return false
  const currentRerankingModel = currentRerankingModelProvider.models.find(model => model.model === rerankingModelName)
  if (!currentRerankingModel)
    return false
  const isRerankingModelSupportMultiModal = !!currentRerankingModel.features?.includes(ModelFeatureEnum.vision)
  return !isRerankingModelSupportMultiModal
}
