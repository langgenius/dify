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
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE, TONE_LIST } from '@/config'
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
        <PortalToFollowElemContent className={cn('z-[60]', portalToFollowElemContentClassName)}>
          <div className={cn(popupClassName, 'w-[389px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg')}>
            <div className={cn('max-h-[420px] overflow-y-auto p-4 pt-3')}>
              <div className='relative'>
                <div className={cn('system-sm-semibold mb-1 flex h-6 items-center text-text-secondary')}>
                  {t('common.modelProvider.model').toLocaleUpperCase()}
                </div>
                <ModelSelector
                  defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
                  modelList={activeTextGenerationModelList}
                  onSelect={handleChangeModel}
                />
              </div>
              {
                !!parameterRules.length && (
                  <div className='my-3 h-px bg-divider-subtle' />
                )
              }
              {
                isLoading && (
                  <div className='mt-5'><Loading /></div>
                )
              }
              {
                !isLoading && !!parameterRules.length && (
                  <div className='mb-2 flex items-center justify-between'>
                    <div className={cn('system-sm-semibold flex h-6 items-center text-text-secondary')}>{t('common.modelProvider.parameters')}</div>
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
                    ...(isAdvancedMode ? [STOP_PARAMETER_RULE] : []),
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
            {!hideDebugWithMultipleModel && (
              <div
                className='bg-components-section-burn system-sm-regular flex h-[50px] cursor-pointer items-center justify-between rounded-b-xl border-t border-t-divider-subtle px-4 text-text-accent'
                onClick={() => onDebugWithMultipleModelChange?.()}
              >
                {
                  debugWithMultipleModel
                    ? t('appDebug.debugAsSingleModel')
                    : t('appDebug.debugAsMultipleModel')
                }
                <ArrowNarrowLeft className='h-3 w-3 rotate-180' />
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelParameterModal
