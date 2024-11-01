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
} from '../declarations'
import { ModelStatusEnum } from '../declarations'
import ModelSelector from '../model-selector'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '../hooks'
import ParameterItem from './parameter-item'
import type { ParameterValue } from './parameter-item'
import Trigger from './trigger'
import type { TriggerProps } from './trigger'
import PresetsParameter from './presets-parameter'
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
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'

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
  hideDebugWithMultipleModel?: boolean
  debugWithMultipleModel?: boolean
  onDebugWithMultipleModelChange?: () => void
  renderTrigger?: (v: TriggerProps) => ReactNode
  readonly?: boolean
  isInWorkflow?: boolean
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

const PROVIDER_WITH_PRESET_TONE = ['openai', 'azure_openai']
const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
  portalToFollowElemContentClassName,
  isAdvancedMode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  hideDebugWithMultipleModel,
  debugWithMultipleModel,
  onDebugWithMultipleModelChange,
  renderTrigger,
  readonly,
  isInWorkflow,
}) => {
  const { t } = useTranslation()
  const { isAPIKeySet } = useProviderContext()
  const [open, setOpen] = useState(false)
  const { data: parameterRulesData, isLoading } = useSWR((provider && modelId) ? `/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}` : null, fetchModelParameterRules)
  const {
    currentProvider,
    currentModel,
    activeTextGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    { provider, model: modelId },
  )

  const hasDeprecated = !currentProvider || !currentModel
  const modelDisabled = currentModel?.status !== ModelStatusEnum.active
  const disabled = !isAPIKeySet || hasDeprecated || modelDisabled

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
    const targetProvider = activeTextGenerationModelList.find(modelItem => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find(modelItem => modelItem.model === model)
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
        <PortalToFollowElemContent className={cn(portalToFollowElemContentClassName, 'z-[60]')}>
          <div className={cn(popupClassName, 'w-[496px] rounded-xl border border-gray-100 bg-white shadow-xl')}>
            <div className={cn(
              'max-h-[480px]  overflow-y-auto',
              !isInWorkflow && 'px-10 pt-6 pb-8',
              isInWorkflow && 'p-4')}>
              <div className='flex items-center justify-between h-8'>
                <div className={cn('font-semibold text-gray-900 shrink-0', isInWorkflow && 'text-[13px]')}>
                  {t('common.modelProvider.model').toLocaleUpperCase()}
                </div>
                <ModelSelector
                  defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
                  modelList={activeTextGenerationModelList}
                  onSelect={handleChangeModel}
                  triggerClassName='max-w-[295px]'
                />
              </div>
              {
                !!parameterRules.length && (
                  <div className='my-5 h-[1px] bg-gray-100' />
                )
              }
              {
                isLoading && (
                  <div className='mt-5'><Loading /></div>
                )
              }
              {
                !isLoading && !!parameterRules.length && (
                  <div className='flex items-center justify-between mb-4'>
                    <div className={cn('font-semibold text-gray-900', isInWorkflow && 'text-[13px]')}>{t('common.modelProvider.parameters')}</div>
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
                      className='mb-4'
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
            {!hideDebugWithMultipleModel && (
              <div
                className='flex items-center justify-between px-6 h-[50px] bg-gray-50 border-t border-t-gray-100 text-xs font-medium text-primary-600 cursor-pointer rounded-b-xl'
                onClick={() => onDebugWithMultipleModelChange?.()}
              >
                {
                  debugWithMultipleModel
                    ? t('appDebug.debugAsSingleModel')
                    : t('appDebug.debugAsMultipleModel')
                }
                <ArrowNarrowLeft className='w-3 h-3 rotate-180' />
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelParameterModal
