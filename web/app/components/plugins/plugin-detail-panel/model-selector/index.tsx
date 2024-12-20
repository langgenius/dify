import type {
  FC,
  ReactNode,
} from 'react'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  DefaultModel,
  FormValue,
  ModelParameterRule,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ParameterItem from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import type { ParameterValue } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import Trigger from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import PresetsParameter from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/presets-parameter'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { fetchModelParameterRules } from '@/service/common'
import Loading from '@/app/components/base/loading'
import { useProviderContext } from '@/context/provider-context'
import { TONE_LIST } from '@/config'

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
const stopParameterRule: ModelParameterRule = {
  default: [],
  help: {
    en_US: 'Up to four sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.',
    zh_Hans: '最多四个序列，API 将停止生成更多的 token。返回的文本将不包含停止序列。',
  },
  label: {
    en_US: 'Stop sequences',
    zh_Hans: '停止序列',
  },
  name: 'stop',
  required: false,
  type: 'tag',
  tagPlaceholder: {
    en_US: 'Enter sequence and press Tab',
    zh_Hans: '输入序列并按 Tab 键',
  },
}

const PROVIDER_WITH_PRESET_TONE = ['langgenius/openai/openai', 'langgenius/azure_openai/azure_openai']
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
  const { data: parameterRulesData, isLoading } = useSWR(
    (provider && modelId && (scopeArray.includes('text-generation') || scopeArray.includes('all')))
      ? `/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}`
      : null, fetchModelParameterRules,
  )
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
    // if (scopeArray.includes('vision'))
    //   return textGenerationList
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

  const parameterRules: ModelParameterRule[] = useMemo(() => {
    return parameterRulesData?.data || []
  }, [parameterRulesData])

  const handleParamChange = (key: string, value: ParameterValue) => {
    onCompletionParamsChange({
      ...completionParams,
      [key]: value,
    })
  }

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

  const handleSwitch = (key: string, value: boolean, assignValue: ParameterValue) => {
    if (!value) {
      const newCompletionParams = { ...completionParams }
      delete newCompletionParams[key]

      onCompletionParamsChange(newCompletionParams)
    }
    if (value) {
      onCompletionParamsChange({
        ...completionParams,
        [key]: assignValue,
      })
    }
  }

  const handleSelectPresetParameter = (toneId: number) => {
    const tone = TONE_LIST.find(tone => tone.id === toneId)
    if (tone) {
      onCompletionParamsChange({
        ...completionParams,
        ...tone.config,
      })
    }
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
                  onSelect={handleChangeModel}
                />
              </div>
              {
                !!parameterRules.length && (
                  <div className='my-3 h-[1px] bg-divider-subtle' />
                )
              }
              {
                isLoading && (
                  <div className='mt-5'><Loading /></div>
                )
              }
              {
                !isLoading && !!parameterRules.length && (
                  <div className='flex items-center justify-between mb-2'>
                    <div className={cn('h-6 flex items-center text-text-secondary system-sm-semibold')}>{t('common.modelProvider.parameters')}</div>
                    {
                      PROVIDER_WITH_PRESET_TONE.includes(provider) && (
                        <PresetsParameter onSelect={handleSelectPresetParameter} />
                      )
                    }
                  </div>
                )
              }
              {
                !isLoading && !!parameterRules.length && (
                  [
                    ...parameterRules,
                    ...(isAdvancedMode ? [stopParameterRule] : []),
                  ].map(parameter => (
                    <ParameterItem
                      key={`${modelId}-${parameter.name}`}
                      parameterRule={parameter}
                      value={completionParams?.[parameter.name]}
                      onChange={v => handleParamChange(parameter.name, v)}
                      onSwitch={(checked, assignValue) => handleSwitch(parameter.name, checked, assignValue)}
                      isInWorkflow={isInWorkflow}
                    />
                  ))
                )
              }
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelParameterModal
