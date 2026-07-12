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
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import Loading from '@/app/components/base/loading'
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE } from '@/config'
import { useModelParameterRules } from '@/service/use-common'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '../hooks'
import ModelSelector from '../model-selector'
import ParameterItem from './parameter-item'
import PresetsParameter from './presets-parameter'
import { getSupportedPresetConfig } from './presets-parameter-utils'

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
  const {
    data: parameterRulesData,
    isLoading,
  } = useModelParameterRules(provider, modelId)
  const isRulesLoading = !!provider && !!modelId && isLoading
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
  const supportedPresetParameterNames = useMemo(() => {
    return parameterRules.map(parameterRule => parameterRule.name)
  }, [parameterRules])

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
    onCompletionParamsChange({
      ...completionParams,
      ...getSupportedPresetConfig(toneId, supportedPresetParameterNames),
    })
  }

  const hasSelectedModel = !!provider && !!modelId

  return (
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (readonly)
          return
        setOpen(newOpen)
      }}
    >
      {renderTrigger
        ? (
            <PopoverTrigger
              render={(
                <button type="button" className="block w-full border-none bg-transparent p-0 text-left text-inherit [font:inherit]">
                  {renderTrigger({
                    open,
                    currentProvider,
                    currentModel,
                    providerName: provider,
                    modelId,
                  })}
                </button>
              )}
            />
          )
        : (
            <div className="flex h-8 min-w-[296px] items-center gap-px overflow-hidden rounded-lg">
              <div className="min-w-0 flex-1">
                <ModelSelector
                  defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
                  modelList={activeTextGenerationModelList}
                  readonly={readonly}
                  triggerClassName={cn(
                    'h-8! w-full rounded-r-none!',
                    isInWorkflow && 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg hover:bg-workflow-block-parma-bg',
                  )}
                  onSelect={handleChangeModel}
                />
              </div>
              <PopoverTrigger
                aria-label={t($ => $['modelProvider.modelSettings'], { ns: 'common' })}
                disabled={readonly || !hasSelectedModel}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-l-none rounded-r-lg border-0 bg-components-button-tertiary-bg p-0 text-text-tertiary outline-hidden hover:bg-components-button-tertiary-bg-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled',
                  isInWorkflow && 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg hover:bg-workflow-block-parma-bg',
                )}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              </PopoverTrigger>
            </div>
          )}
      <PopoverContent
        placement={isInWorkflow ? 'left' : (renderTrigger ? 'bottom-end' : 'left-start')}
        sideOffset={4}
        popupClassName={cn(popupClassName, 'w-[400px] rounded-2xl')}
      >
        <div className="relative px-3 pt-3.5 pb-1">
          <div className="pr-8 pl-1 system-xl-semibold text-text-primary">
            {t($ => $['modelProvider.modelSettings'], { ns: 'common' })}
          </div>
          <PopoverClose className="absolute top-2.5 right-2.5 flex items-center justify-center rounded-lg p-1.5 hover:bg-state-base-hover">
            <span className="i-ri-close-line size-4 text-text-tertiary" />
          </PopoverClose>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {renderTrigger && (
            <div className="px-4 pt-2 pb-4">
              <ModelSelector
                defaultModel={hasSelectedModel ? { provider, model: modelId } : undefined}
                modelList={activeTextGenerationModelList}
                onSelect={handleChangeModel}
                onHide={() => setOpen(false)}
              />
            </div>
          )}
          {
            !!parameterRules.length && (
              <div className={cn('flex flex-col gap-2 px-4 pt-3 pb-4', renderTrigger && 'border-t border-divider-subtle')}>
                <div className="flex items-center gap-1">
                  <div className="flex flex-1 items-center system-sm-semibold-uppercase text-text-secondary">{t($ => $['modelProvider.parameters'], { ns: 'common' })}</div>
                  {
                    PROVIDER_WITH_PRESET_TONE.includes(provider) && (
                      <PresetsParameter
                        onSelect={handleSelectPresetParameter}
                        supportedParameterNames={supportedPresetParameterNames}
                      />
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
                ? t($ => $.debugAsSingleModel, { ns: 'appDebug' })
                : t($ => $.debugAsMultipleModel, { ns: 'appDebug' })
            }
            <ArrowNarrowLeft className="size-3 rotate-180" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default ModelParameterModal
