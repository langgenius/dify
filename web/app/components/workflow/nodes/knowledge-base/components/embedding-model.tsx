import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MultimodalRetrievalGuidance,
  MultimodalRetrievalGuidanceLearnMore,
} from '@/app/components/datasets/common/multimodal-retrieval-guidance'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'

type EmbeddingModelProps = {
  embeddingModel?: string
  embeddingModelProvider?: string
  onEmbeddingModelChange?: (model: {
    embeddingModel: string
    embeddingModelProvider: string
  }) => void
  warningDot?: boolean
  readonly?: boolean
}
const EmbeddingModel = ({
  embeddingModel,
  embeddingModelProvider,
  onEmbeddingModelChange,
  warningDot = false,
  readonly = false,
}: EmbeddingModelProps) => {
  const { t } = useTranslation()
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const embeddingModelConfig = useMemo(() => {
    if (!embeddingModel || !embeddingModelProvider) return undefined

    return {
      providerName: embeddingModelProvider,
      modelName: embeddingModel,
    }
  }, [embeddingModel, embeddingModelProvider])

  const handleEmbeddingModelChange = useCallback(
    (model: DefaultModel) => {
      onEmbeddingModelChange?.({
        embeddingModelProvider: model.provider,
        embeddingModel: model.model,
      })
    },
    [onEmbeddingModelChange],
  )

  return (
    <Field
      fieldTitleProps={{
        title: t(($) => $['form.embeddingModel'], { ns: 'datasetSettings' }),
        subTitle: <MultimodalRetrievalGuidanceLearnMore />,
        warningDot,
      }}
    >
      <MultimodalRetrievalGuidance
        variant="pipeline"
        embeddingModel={
          embeddingModelConfig && {
            provider: embeddingModelConfig.providerName,
            model: embeddingModelConfig.modelName,
          }
        }
        embeddingModelList={embeddingModelList}
        className="mb-2"
      />
      <ModelSelector
        value={
          embeddingModelConfig && {
            provider: embeddingModelConfig.providerName,
            model: embeddingModelConfig.modelName,
          }
        }
        models={embeddingModelList}
        onValueChange={handleEmbeddingModelChange}
        disabled={readonly}
        showDeprecatedWarnIcon
      />
    </Field>
  )
}
export default memo(EmbeddingModel)
