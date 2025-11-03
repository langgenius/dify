import type {
  FC,
  ReactNode,
} from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DefaultModel,
  FormValue,
  ModelFeatureEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import AgentModelTrigger from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/agent-model-trigger'
import Trigger from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import LLMParamsPanel from './llm-params-panel'
import TTSParamsPanel from './tts-params-panel'
import { useProviderContext } from '@/context/provider-context'
import cn from '@/utils/classnames'
import Toast from '@/app/components/base/toast'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'

export type ModelParameterModalProps = {
  popupClassName?: string
  portalToFollowElemContentClassName?: string
  isAdvancedMode: boolean
  value: any
  setModel: (model: any) => void
  renderTrigger?: (v: TriggerProps) => ReactNode
  readonly?: boolean
  isInWorkflow?: boolean
  isAgentStrategy?: boolean
  scope?: string
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
  portalToFollowElemContentClassName,
  isAdvancedMode,
  value,
  setModel,
  renderTrigger,
  readonly,
  isInWorkflow,
  isAgentStrategy,
  scope = ModelTypeEnum.textGeneration,
}) => {
  const { t } = useTranslation()
  const { isAPIKeySet } = useProviderContext()
  const [open, setOpen] = useState(false)
  const scopeArray = scope.split('&')
  const scopeFeatures = useMemo((): ModelFeatureEnum[] => {
    if (scopeArray.includes('all'))
      return []
    return scopeArray.filter(item => ![
      ModelTypeEnum.textGeneration,
      ModelTypeEnum.textEmbedding,
      ModelTypeEnum.rerank,
      ModelTypeEnum.moderation,
      ModelTypeEnum.speech2text,
      ModelTypeEnum.tts,
    ].includes(item as ModelTypeEnum)).map(item => item as ModelFeatureEnum)
  }, [scopeArray])

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
    if (scopeArray.includes(ModelTypeEnum.textGeneration))
      return textGenerationList
    if (scopeArray.includes(ModelTypeEnum.textEmbedding))
      return textEmbeddingList
    if (scopeArray.includes(ModelTypeEnum.rerank))
      return rerankList
    if (scopeArray.includes(ModelTypeEnum.moderation))
      return moderationList
    if (scopeArray.includes(ModelTypeEnum.speech2text))
      return sttList
    if (scopeArray.includes(ModelTypeEnum.tts))
      return ttsList
    return resultList
  }, [scopeArray, textGenerationList, textEmbeddingList, rerankList, sttList, ttsList, moderationList])

  const { currentProvider, currentModel } = useMemo(() => {
    const currentProvider = scopedModelList.find(item => item.provider === value?.provider)
    const currentModel = currentProvider?.models.find((model: { model: string }) => model.model === value?.model)
    return {
      currentProvider,
      currentModel,
    }
  }, [scopedModelList, value?.provider, value?.model])

  const hasDeprecated = useMemo(() => {
    return !currentProvider || !currentModel
  }, [currentModel, currentProvider])
  const modelDisabled = useMemo(() => {
    return currentModel?.status !== ModelStatusEnum.active
  }, [currentModel?.status])
  const disabled = useMemo(() => {
    return !isAPIKeySet || hasDeprecated || modelDisabled
  }, [hasDeprecated, isAPIKeySet, modelDisabled])

  const handleChangeModel = async ({ provider, model }: DefaultModel) => {
    const targetProvider = scopedModelList.find(modelItem => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find((modelItem: { model: string }) => modelItem.model === model)
    const model_type = targetModelItem?.model_type as string

    let nextCompletionParams: FormValue = {}

    if (model_type === ModelTypeEnum.textGeneration) {
      try {
        const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
          provider,
          model,
          value?.completion_params,
          isAdvancedMode,
        )
        nextCompletionParams = filtered

        const keys = Object.keys(removedDetails || {})
        if (keys.length) {
          Toast.notify({
            type: 'warning',
            message: `${t('common.modelProvider.parametersInvalidRemoved')}: ${keys.map(k => `${k} (${removedDetails[k]})`).join(', ')}`,
          })
        }
      }
      catch {
        Toast.notify({ type: 'error', message: t('common.error') })
      }
    }

    setModel({
      provider,
      model,
      model_type,
      ...(model_type === ModelTypeEnum.textGeneration ? {
        mode: targetModelItem?.model_properties.mode as string,
        completion_params: nextCompletionParams,
      } : {}),
    })
  }

  const handleLLMParamsChange = (newParams: FormValue) => {
    const newValue = {
      ...value?.completionParams,
      completion_params: newParams,
    }
    setModel({
      ...value,
      ...newValue,
    })
  }

  const handleTTSParamsChange = (language: string, voice: string) => {
    setModel({
      ...value,
      language,
      voice,
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
                providerName: value?.provider,
                modelId: value?.model,
              })
              : (isAgentStrategy
                ? <AgentModelTrigger
                  disabled={disabled}
                  hasDeprecated={hasDeprecated}
                  currentProvider={currentProvider}
                  currentModel={currentModel}
                  providerName={value?.provider}
                  modelId={value?.model}
                  scope={scope}
                />
                : <Trigger
                  disabled={disabled}
                  isInWorkflow={isInWorkflow}
                  modelDisabled={modelDisabled}
                  hasDeprecated={hasDeprecated}
                  currentProvider={currentProvider}
                  currentModel={currentModel}
                  providerName={value?.provider}
                  modelId={value?.model}
                />
              )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className={cn('z-50', portalToFollowElemContentClassName)}>
          <div className={cn(popupClassName, 'w-[389px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg')}>
            <div className={cn('max-h-[420px] overflow-y-auto p-4 pt-3')}>
              <div className='relative'>
                <div className={cn('system-sm-semibold mb-1 flex h-6 items-center text-text-secondary')}>
                  {t('common.modelProvider.model').toLocaleUpperCase()}
                </div>
                <ModelSelector
                  defaultModel={(value?.provider || value?.model) ? { provider: value?.provider, model: value?.model } : undefined}
                  modelList={scopedModelList}
                  scopeFeatures={scopeFeatures}
                  onSelect={handleChangeModel}
                />
              </div>
              {(currentModel?.model_type === ModelTypeEnum.textGeneration || currentModel?.model_type === ModelTypeEnum.tts) && (
                <div className='my-3 h-px bg-divider-subtle' />
              )}
              {currentModel?.model_type === ModelTypeEnum.textGeneration && (
                <LLMParamsPanel
                  provider={value?.provider}
                  modelId={value?.model}
                  completionParams={value?.completion_params || {}}
                  onCompletionParamsChange={handleLLMParamsChange}
                  isAdvancedMode={isAdvancedMode}
                />
              )}
              {currentModel?.model_type === ModelTypeEnum.tts && (
                <TTSParamsPanel
                  currentModel={currentModel}
                  language={value?.language}
                  voice={value?.voice}
                  onChange={handleTTSParamsChange}
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
