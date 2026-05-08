import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import Indicator from '@/app/components/header/indicator'

type ModelBarProps = {
  provider: string
  model: string
} | {
  provider?: never
  model?: never
}

const useAllModel = () => {
  const { data: textGeneration } = useModelList(ModelTypeEnum.textGeneration)
  const { data: moderation } = useModelList(ModelTypeEnum.moderation)
  const { data: rerank } = useModelList(ModelTypeEnum.rerank)
  const { data: speech2text } = useModelList(ModelTypeEnum.speech2text)
  const { data: textEmbedding } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: tts } = useModelList(ModelTypeEnum.tts)
  const models = useMemo(() => {
    return textGeneration
      .concat(moderation)
      .concat(rerank)
      .concat(speech2text)
      .concat(textEmbedding)
      .concat(tts)
  }, [textGeneration, moderation, rerank, speech2text, textEmbedding, tts])
  if (!textGeneration || !moderation || !rerank || !speech2text || !textEmbedding || !tts)
    return undefined
  return models
}

export const ModelBar: FC<ModelBarProps> = (props) => {
  const { t } = useTranslation()
  const modelList = useAllModel()
  if (props.provider === undefined) {
    const tooltip = t('nodes.agent.modelNotSelected', { ns: 'workflow' })

    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="relative" aria-label={tooltip}>
              <ModelSelector
                modelList={[]}
                triggerClassName="bg-workflow-block-parma-bg h-6! rounded-md!"
                defaultModel={undefined}
                showDeprecatedWarnIcon={false}
                readonly
                deprecatedClassName="opacity-50"
              />
              <Indicator color="red" className="absolute -top-0.5 -right-0.5" />
            </div>
          )}
        />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }
  const modelInstalled = modelList?.some(
    provider => provider.provider === props.provider && provider.models.some(model => model.model === props.model),
  )
  const showWarn = modelList && !modelInstalled
  if (!modelList)
    return null

  const modelNotInstalledTooltip = t('nodes.agent.modelNotInstallTooltip', { ns: 'workflow' })
  const modelSelector = (
    <div className="relative" aria-label={showWarn ? modelNotInstalledTooltip : undefined}>
      <ModelSelector
        modelList={modelList}
        triggerClassName="bg-workflow-block-parma-bg h-6! rounded-md!"
        defaultModel={{
          provider: props.provider,
          model: props.model,
        }}
        showDeprecatedWarnIcon={false}
        readonly
        deprecatedClassName="opacity-50"
      />
      {showWarn && <Indicator color="red" className="absolute -top-0.5 -right-0.5" />}
    </div>
  )

  if (modelInstalled)
    return modelSelector

  return (
    <Tooltip>
      <TooltipTrigger render={modelSelector} />
      <TooltipContent>{modelNotInstalledTooltip}</TooltipContent>
    </Tooltip>
  )
}
