import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type EmbeddingModelProps = {
  embeddingModel?: string
  embeddingModelProvider?: string
  onEmbeddingModelChange?: (model: {
    embeddingModel: string
    embeddingModelProvider: string
  }) => void
  readonly?: boolean
}
const EmbeddingModel = ({
  embeddingModel,
  embeddingModelProvider,
  onEmbeddingModelChange,
  readonly = false,
}: EmbeddingModelProps) => {
  const { t } = useTranslation()
  const {
    data: embeddingModelList,
  } = useModelList(ModelTypeEnum.textEmbedding)
  const embeddingModelConfig = useMemo(() => {
    if (!embeddingModel || !embeddingModelProvider)
      return undefined

    return {
      providerName: embeddingModelProvider,
      modelName: embeddingModel,
    }
  }, [embeddingModel, embeddingModelProvider])

  const handleEmbeddingModelChange = useCallback((model: DefaultModel) => {
    onEmbeddingModelChange?.({
      embeddingModelProvider: model.provider,
      embeddingModel: model.model,
    })
  }, [onEmbeddingModelChange])

  return (
    <Field
      fieldTitleProps={{
        title: t('datasetSettings.form.embeddingModel'),
      }}
    >
      <ModelSelector
        defaultModel={embeddingModelConfig && { provider: embeddingModelConfig.providerName, model: embeddingModelConfig.modelName }}
        modelList={embeddingModelList}
        onSelect={handleEmbeddingModelChange}
        readonly={readonly}
      />
    </Field>
  )
}
export default memo(EmbeddingModel)
