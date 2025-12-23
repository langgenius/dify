import type { RerankingModel } from '../../types'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  memo,
  useMemo,
} from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

export type RerankingModelSelectorProps = {
  rerankingModel?: RerankingModel
  onRerankingModelChange?: (model: RerankingModel) => void
  readonly?: boolean
}
const RerankingModelSelector = ({
  rerankingModel,
  onRerankingModelChange,
  readonly = false,
}: RerankingModelSelectorProps) => {
  const {
    modelList: rerankModelList,
  } = useModelListAndDefaultModel(ModelTypeEnum.rerank)
  const rerankModel = useMemo(() => {
    if (!rerankingModel)
      return undefined

    return {
      providerName: rerankingModel.reranking_provider_name,
      modelName: rerankingModel.reranking_model_name,
    }
  }, [rerankingModel])

  const handleRerankingModelChange = (model: DefaultModel) => {
    onRerankingModelChange?.({
      reranking_provider_name: model.provider,
      reranking_model_name: model.model,
    })
  }

  return (
    <ModelSelector
      defaultModel={rerankModel && { provider: rerankModel.providerName, model: rerankModel.modelName }}
      modelList={rerankModelList}
      onSelect={handleRerankingModelChange}
      readonly={readonly}
      showDeprecatedWarnIcon
    />
  )
}

export default memo(RerankingModelSelector)
