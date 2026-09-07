import type { FC } from 'react'
import type {
  FormValue,
  ModelFeatureEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelSelectorValue } from '@/app/components/header/account-setting/model-provider-page/model-selector/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSettingsTrigger } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/model-settings-trigger'
import { SplitModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import LLMParamsPanel from './llm-params-panel'
import TTSParamsPanel from './tts-params-panel'

type ModelParameterModalProps = {
  popupClassName?: string
  isAdvancedMode: boolean
  value?: PluginModelValue | null
  setModel: (model: PluginModelValue) => void
  readonly?: boolean
  isInWorkflow?: boolean
  scope?: string
}

type PluginModelValue = Record<string, unknown> & {
  completion_params?: FormValue
  completionParams?: FormValue
  language?: string
  model?: string
  model_type?: string
  provider?: string
  voice?: string
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
  isAdvancedMode,
  value,
  setModel,
  readonly,
  isInWorkflow,
  scope = ModelTypeEnum.textGeneration,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const scopeArray = scope.split('&')
  const scopeFeatures = useMemo((): ModelFeatureEnum[] => {
    if (scopeArray.includes('all')) return []
    return scopeArray
      .filter(
        (item) =>
          ![
            ModelTypeEnum.textGeneration,
            ModelTypeEnum.textEmbedding,
            ModelTypeEnum.rerank,
            ModelTypeEnum.moderation,
            ModelTypeEnum.speech2text,
            ModelTypeEnum.tts,
          ].includes(item as ModelTypeEnum),
      )
      .map((item) => item as ModelFeatureEnum)
  }, [scopeArray])

  const { data: textGenerationList } = useModelList(ModelTypeEnum.textGeneration)
  const { data: textEmbeddingList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankList } = useModelList(ModelTypeEnum.rerank)
  const { data: moderationList } = useModelList(ModelTypeEnum.moderation)
  const { data: sttList } = useModelList(ModelTypeEnum.speech2text)
  const { data: ttsList } = useModelList(ModelTypeEnum.tts)

  const scopedModelList = useMemo(() => {
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
    if (scopeArray.includes(ModelTypeEnum.textGeneration)) return textGenerationList
    if (scopeArray.includes(ModelTypeEnum.textEmbedding)) return textEmbeddingList
    if (scopeArray.includes(ModelTypeEnum.rerank)) return rerankList
    if (scopeArray.includes(ModelTypeEnum.moderation)) return moderationList
    if (scopeArray.includes(ModelTypeEnum.speech2text)) return sttList
    if (scopeArray.includes(ModelTypeEnum.tts)) return ttsList
    return []
  }, [
    scopeArray,
    textGenerationList,
    textEmbeddingList,
    rerankList,
    sttList,
    ttsList,
    moderationList,
  ])

  const { currentProvider, currentModel } = useMemo(() => {
    const currentProvider = scopedModelList.find((item) => item.provider === value?.provider)
    const currentModel = currentProvider?.models.find(
      (model: { model: string }) => model.model === value?.model,
    )
    return {
      currentProvider,
      currentModel,
    }
  }, [scopedModelList, value?.provider, value?.model])

  const hasDeprecated = !currentProvider || !currentModel
  const modelSettingsDisabled = hasDeprecated || currentModel?.status !== ModelStatusEnum.active

  const handleChangeModel = async ({ provider, model }: ModelSelectorValue) => {
    const targetProvider = scopedModelList.find((modelItem) => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find(
      (modelItem: { model: string }) => modelItem.model === model,
    )
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
          toast.warning(
            `${t(($) => $['modelProvider.parametersInvalidRemoved'], { ns: 'common' })}: ${keys.map((k) => `${k} (${removedDetails[k]})`).join(', ')}`,
          )
        }
      } catch {
        toast.error(t(($) => $.error, { ns: 'common' }))
      }
    }

    setModel({
      provider,
      model,
      model_type,
      ...(model_type === ModelTypeEnum.textGeneration
        ? {
            mode: targetModelItem?.model_properties.mode as string,
            completion_params: nextCompletionParams,
          }
        : {}),
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

  const selectedModel =
    value?.provider && value.model ? { provider: value.provider, model: value.model } : undefined
  const hasSelectedModel = !!selectedModel
  return (
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (readonly && newOpen) return
        setOpen(newOpen)
      }}
    >
      <div className="relative">
        <div className="isolate flex h-8 min-w-74 items-center gap-px rounded-lg">
          <SplitModelSelector
            value={selectedModel}
            models={scopedModelList}
            disabled={readonly}
            scopeFeatures={scopeFeatures}
            surface={isInWorkflow ? 'workflow' : 'default'}
            onValueChange={handleChangeModel}
          />
          <ModelSettingsTrigger
            disabled={readonly || !hasSelectedModel || modelSettingsDisabled}
            surface={isInWorkflow ? 'workflow' : 'default'}
          />
        </div>
        <PopoverContent
          placement={isInWorkflow ? 'left' : 'bottom-end'}
          sideOffset={4}
          className={cn(popupClassName, 'w-97.25 rounded-2xl')}
        >
          <div className="max-h-105 overflow-y-auto p-4 pt-3">
            {currentModel?.model_type === ModelTypeEnum.textGeneration && selectedModel && (
              <LLMParamsPanel
                provider={selectedModel.provider}
                modelId={selectedModel.model}
                completionParams={value?.completion_params || {}}
                onCompletionParamsChange={handleLLMParamsChange}
                isAdvancedMode={isAdvancedMode}
              />
            )}
            {currentModel?.model_type === ModelTypeEnum.tts && selectedModel && (
              <TTSParamsPanel
                currentModel={currentModel}
                language={value?.language ?? ''}
                voice={value?.voice ?? ''}
                onChange={handleTTSParamsChange}
              />
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default ModelParameterModal
