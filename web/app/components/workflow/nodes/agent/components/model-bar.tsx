import Tooltip from '@/app/components/base/tooltip'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import Indicator from '@/app/components/header/indicator'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type ModelBarProps = {
  provider: string
  model: string
} | {}

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
  if (!('provider' in props)) {
    return <Tooltip
      popupContent={t('workflow.nodes.agent.modelNotSelected')}
      triggerMethod='hover'
    >
      <div className='relative'>
        <ModelSelector
          modelList={[]}
          triggerClassName='bg-workflow-block-parma-bg !h-6 !rounded-md'
          defaultModel={undefined}
          showDeprecatedWarnIcon={false}
          readonly
          deprecatedClassName='opacity-50'
        />
        <Indicator color={'red'} className='absolute -right-0.5 -top-0.5' />
      </div>
    </Tooltip>
  }
  const modelInstalled = modelList?.some(
    provider => provider.provider === props.provider && provider.models.some(model => model.model === props.model))
  const showWarn = modelList && !modelInstalled
  return modelList && <Tooltip
    popupContent={t('workflow.nodes.agent.modelNotInstallTooltip')}
    triggerMethod='hover'
    disabled={!modelList || modelInstalled}
  >
    <div className='relative'>
      <ModelSelector
        modelList={modelList}
        triggerClassName='bg-workflow-block-parma-bg !h-6 !rounded-md'
        defaultModel={props}
        showDeprecatedWarnIcon={false}
        readonly
        deprecatedClassName='opacity-50'
      />
      {showWarn && <Indicator color={'red'} className='absolute -right-0.5 -top-0.5' />}
    </div>
  </Tooltip>
}
