import type {
  FC,
  ReactNode,
} from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DefaultModel,
  FormValue,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import Trigger from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import LLMParamsPanel from './llm-params-panel'
import { useProviderContext } from '@/context/provider-context'
import cn from '@/utils/classnames'

export type ModelParameterModalProps = {
  popupClassName?: string
  portalToFollowElemContentClassName?: string
  isAdvancedMode: boolean
  mode: string
  modelId: string
  provider: string
  setModel: (model: { modelId: string; provider: string; mode?: string; features?: string[] }) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  renderTrigger?: (v: TriggerProps) => ReactNode
  readonly?: boolean
  isInWorkflow?: boolean
  scope?: string
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
  portalToFollowElemContentClassName,
  isAdvancedMode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  renderTrigger,
  readonly,
  isInWorkflow,
  scope = 'text-generation',
}) => {
  const { t } = useTranslation()
  const { isAPIKeySet } = useProviderContext()
  const [open, setOpen] = useState(false)
  const scopeArray = scope.split('&')
  const scopeFeatures = scopeArray.slice(1) || []

  const { data: textGenerationList } = useModelList(ModelTypeEnum.textGeneration)
  const { data: textEmbeddingList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankList } = useModelList(ModelTypeEnum.rerank)
  const { data: moderationList } = useModelList(ModelTypeEnum.moderation)
  const { data: sttList } = useModelList(ModelTypeEnum.speech2text)
  const { data: ttsList } = useModelList(ModelTypeEnum.tts)

  const scopedModelList = useMemo(() => {
    const resultList: any[] = []
    if (scopeArray.includes('all')) {
      return [
        ...textGenerationList,
        ...textEmbeddingList,
        ...rerankList,
        ...sttList,
        ...ttsList,
        ...moderationList,
      ]
    }
    if (scopeArray.includes('text-generation'))
      return textGenerationList
    if (scopeArray.includes('embedding'))
      return textEmbeddingList
    if (scopeArray.includes('rerank'))
      return rerankList
    if (scopeArray.includes('moderation'))
      return moderationList
    if (scopeArray.includes('stt'))
      return sttList
    if (scopeArray.includes('tts'))
      return ttsList
    return resultList
  }, [scopeArray, textGenerationList, textEmbeddingList, rerankList, sttList, ttsList, moderationList])

  const { currentProvider, currentModel } = useMemo(() => {
    const currentProvider = scopedModelList.find(item => item.provider === provider)
    const currentModel = currentProvider?.models.find((model: { model: string }) => model.model === modelId)
    return {
      currentProvider,
      currentModel,
    }
  }, [provider, modelId, scopedModelList])

  const hasDeprecated = useMemo(() => {
    return !currentProvider || !currentModel
  }, [currentModel, currentProvider])
  const modelDisabled = useMemo(() => {
    return currentModel?.status !== ModelStatusEnum.active
  }, [currentModel?.status])
  const disabled = useMemo(() => {
    return !isAPIKeySet || hasDeprecated || modelDisabled
  }, [hasDeprecated, isAPIKeySet, modelDisabled])

  const handleChangeModel = ({ provider, model }: DefaultModel) => {
    const targetProvider = scopedModelList.find(modelItem => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find((modelItem: { model: string }) => modelItem.model === model)
    setModel({
      modelId: model,
      provider,
      mode: targetModelItem?.model_properties.mode as string,
      features: targetModelItem?.features || [],
    })
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={isInWorkflow ? 'left' : 'bottom-end'}
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => {
            if (readonly)
              return
            setOpen(v => !v)
          }}
          className='block'
        >
          {
            renderTrigger
              ? renderTrigger({
                open,
                disabled,
                modelDisabled,
                hasDeprecated,
                currentProvider,
                currentModel,
                providerName: provider,
                modelId,
              })
              : (
                <Trigger
                  disabled={disabled}
                  isInWorkflow={isInWorkflow}
                  modelDisabled={modelDisabled}
                  hasDeprecated={hasDeprecated}
                  currentProvider={currentProvider}
                  currentModel={currentModel}
                  providerName={provider}
                  modelId={modelId}
                />
              )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className={cn('z-[60]', portalToFollowElemContentClassName)}>
          <div className={cn(popupClassName, 'w-[389px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg')}>
            <div className={cn('max-h-[420px] p-4 pt-3 overflow-y-auto')}>
              <div className='relative'>
                <div className={cn('mb-1 h-6 flex items-center text-text-secondary system-sm-semibold')}>
                  {t('common.modelProvider.model').toLocaleUpperCase()}
                </div>
                <ModelSelector
                  defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
                  modelList={scopedModelList}
                  scopeFeatures={scopeFeatures}
                  onSelect={handleChangeModel}
                />
              </div>
              {(currentModel?.model_type === ModelTypeEnum.textGeneration || currentModel?.model_type === ModelTypeEnum.tts) && (
                <div className='my-3 h-[1px] bg-divider-subtle' />
              )}
              {currentModel?.model_type === ModelTypeEnum.textGeneration && (
                <LLMParamsPanel
                  provider={provider}
                  modelId={modelId}
                  completionParams={completionParams}
                  onCompletionParamsChange={onCompletionParamsChange}
                  isAdvancedMode={isAdvancedMode}
                />
              )}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelParameterModal
