import type {
  FC,
  ReactNode,
} from 'react'
import type {
  DefaultModel,
  FormValue,
  ModelParameterRule,
} from '../declarations'
import type { ParameterValue } from './parameter-item'
import type { TriggerProps } from './trigger'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import Loading from '@/app/components/base/loading'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE, TONE_LIST } from '@/config'
import { useModelParameterRules } from '@/service/use-common'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '../hooks'
import ModelSelector from '../model-selector'
import ParameterItem from './parameter-item'
import PresetsParameter from './presets-parameter'
import Trigger from './trigger'

export type ModelParameterModalProps = {
  popupClassName?: string
  isAdvancedMode: boolean
  modelId: string
  provider: string
  setModel: (model: { modelId: string, provider: string, mode?: string, features?: string[] }) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  hideDebugWithMultipleModel?: boolean
  debugWithMultipleModel?: boolean
  onDebugWithMultipleModelChange?: () => void
  renderTrigger?: (v: TriggerProps) => ReactNode
  readonly?: boolean
  isInWorkflow?: boolean
  scope?: string
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
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
  nodesOutputVars,
  availableNodes,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const settingsIconRef = useRef<HTMLDivElement>(null)
  const {
    data: parameterRulesData,
    isPending,
    isLoading,
  } = useModelParameterRules(provider, modelId)
  const isRulesLoading = isPending || isLoading
  const {
    currentProvider,
    currentModel,
    activeTextGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    { provider, model: modelId },
  )

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
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (readonly)
          return
        setOpen(newOpen)
      }}
    >
      <PopoverTrigger
        render={(
          <button type="button" className="block w-full border-none bg-transparent p-0 text-left text-inherit [font:inherit]">
            {
              renderTrigger
                ? renderTrigger({
                    open,
                    currentProvider,
                    currentModel,
                    providerName: provider,
                    modelId,
                  })
                : (
                    <Trigger
                      isInWorkflow={isInWorkflow}
                      currentProvider={currentProvider}
                      currentModel={currentModel}
                      providerName={provider}
                      modelId={modelId}
                      settingsRef={settingsIconRef}
                    />
                  )
            }
          </button>
        )}
      />
      <PopoverContent
        placement={isInWorkflow ? 'left' : (renderTrigger ? 'bottom-end' : 'left-start')}
        sideOffset={4}
        popupClassName={cn(popupClassName, 'w-[400px] rounded-2xl')}
        positionerProps={!renderTrigger ? { anchor: settingsIconRef } : undefined}
      >
        <div className="relative px-3 pt-3.5 pb-1">
          <div className="pr-8 pl-1 system-xl-semibold text-text-primary">
            {t('modelProvider.modelSettings', { ns: 'common' })}
          </div>
          <PopoverClose className="absolute top-2.5 right-2.5 flex items-center justify-center rounded-lg p-1.5 hover:bg-state-base-hover">
            <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
          </PopoverClose>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <div className="px-4 pt-2 pb-4">
            <ModelSelector
              defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
              modelList={activeTextGenerationModelList}
              onSelect={handleChangeModel}
              onHide={() => setOpen(false)}
            />
          </div>
          {
            !!parameterRules.length && (
              <div className="flex flex-col gap-2 border-t border-divider-subtle px-4 pt-3 pb-4">
                <div className="flex items-center gap-1">
                  <div className="flex flex-1 items-center system-sm-semibold-uppercase text-text-secondary">{t('modelProvider.parameters', { ns: 'common' })}</div>
                  {
                    PROVIDER_WITH_PRESET_TONE.includes(provider) && (
                      <PresetsParameter onSelect={handleSelectPresetParameter} />
                    )
                  }
                </div>
                {
                  isRulesLoading
                    ? <div className="py-5"><Loading /></div>
                    : (
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
                            nodesOutputVars={nodesOutputVars}
                            availableNodes={availableNodes}
                          />
                        ))
                      )
                }
              </div>
            )
          }
          {
            !parameterRules.length && isRulesLoading && (
              <div className="px-4 py-5"><Loading /></div>
            )
          }
        </div>
        {!hideDebugWithMultipleModel && (
          <div
            className="flex h-[50px] cursor-pointer items-center justify-between rounded-b-xl border-t border-t-divider-subtle px-4 system-sm-regular text-text-accent"
            onClick={() => onDebugWithMultipleModelChange?.()}
          >
            {
              debugWithMultipleModel
                ? t('debugAsSingleModel', { ns: 'appDebug' })
                : t('debugAsMultipleModel', { ns: 'appDebug' })
            }
            <ArrowNarrowLeft className="h-3 w-3 rotate-180" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default ModelParameterModal
