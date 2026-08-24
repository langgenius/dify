import type { PopoverContentProps } from '@langgenius/dify-ui/popover'
import type { ComponentPropsWithRef, FC, ReactElement } from 'react'
import type { FormValue, ModelParameterRule } from '../declarations'
import type {
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from '../model-selector/types'
import type { ParameterValue } from './parameter-item'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import Loading from '@/app/components/base/loading'
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE } from '@/config'
import { useModelParameterRules } from '@/service/use-common'
import { ModelStatusEnum } from '../declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '../hooks'
import { ModelSelector, SplitModelSelector } from '../model-selector'
import { ModelSettingsTrigger } from './model-settings-trigger'
import ParameterItem from './parameter-item'
import PresetsParameter from './presets-parameter'
import { getSupportedPresetConfig } from './presets-parameter-utils'

export type ModelParameterModalProps = Pick<PopoverContentProps, 'placement'> & {
  trigger?: ReactElement<ComponentPropsWithRef<'button'>>
  popupClassName?: string
  modelSelectorPopupClassName?: string
  isAdvancedMode: boolean
  modelId: string
  provider: string
  setModel: (
    model: Omit<ModelSelectorValue, 'model'> & {
      modelId: ModelSelectorValue['model']
      mode?: string
      features?: string[]
    },
  ) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  hideDebugWithMultipleModel?: boolean
  debugWithMultipleModel?: boolean
  onDebugWithMultipleModelChange?: () => void
  readonly?: boolean
  modelSelectorReadonly?: boolean
  isInWorkflow?: boolean
  scope?: string
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  modelList?: ModelSelectorProvider[]
  showModelMeta?: boolean
  modelPredicate?: ModelSelectorModelPredicate
  modelSuggestionPredicate?: ModelSelectorModelPredicate
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  trigger,
  popupClassName,
  modelSelectorPopupClassName,
  placement,
  isAdvancedMode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  hideDebugWithMultipleModel,
  debugWithMultipleModel,
  onDebugWithMultipleModelChange,
  readonly,
  modelSelectorReadonly,
  isInWorkflow,
  nodesOutputVars,
  availableNodes,
  modelList,
  showModelMeta,
  modelPredicate,
  modelSuggestionPredicate,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: parameterRulesData, isLoading } = useModelParameterRules(provider, modelId)
  const isRulesLoading = !!provider && !!modelId && isLoading
  const { currentProvider, currentModel, activeTextGenerationModelList } =
    useTextGenerationCurrentProviderAndModelAndModelList({ provider, model: modelId })
  const selectableModelList = modelList ?? activeTextGenerationModelList

  const parameterRules: ModelParameterRule[] = useMemo(() => {
    return parameterRulesData?.data || []
  }, [parameterRulesData])
  const supportedPresetParameterNames = useMemo(() => {
    return parameterRules.map((parameterRule) => parameterRule.name)
  }, [parameterRules])

  const handleParamChange = (key: string, value: ParameterValue) => {
    onCompletionParamsChange({
      ...completionParams,
      [key]: value,
    })
  }

  const handleChangeModel = ({ provider, model, plugin_id }: ModelSelectorValue) => {
    const targetProvider = selectableModelList.find((modelItem) => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find((modelItem) => modelItem.model === model)
    setModel({
      modelId: model,
      provider,
      plugin_id,
      mode: targetModelItem?.model_properties.mode as string,
      features: [...(targetModelItem?.features ?? [])],
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
  const canConfigureModelSettings =
    !readonly &&
    hasSelectedModel &&
    !!currentProvider &&
    !!currentModel &&
    currentModel.status === ModelStatusEnum.active &&
    (modelPredicate?.(currentProvider, currentModel) ?? true)

  return (
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (readonly && newOpen) return
        setOpen(newOpen)
      }}
    >
      {trigger ? (
        <PopoverTrigger render={trigger} />
      ) : (
        <div className="isolate flex h-8 min-w-74 items-center gap-px rounded-lg">
          <SplitModelSelector
            value={hasSelectedModel ? { provider, model: modelId } : undefined}
            models={selectableModelList}
            popupClassName={modelSelectorPopupClassName}
            disabled={readonly || modelSelectorReadonly}
            showModelMeta={showModelMeta}
            surface={isInWorkflow ? 'workflow' : 'default'}
            modelPredicate={modelPredicate}
            modelSuggestionPredicate={modelSuggestionPredicate}
            onValueChange={handleChangeModel}
          />
          <ModelSettingsTrigger
            disabled={!canConfigureModelSettings}
            surface={isInWorkflow ? 'workflow' : 'default'}
          />
        </div>
      )}
      <PopoverContent
        placement={placement ?? (isInWorkflow ? 'left' : trigger ? 'bottom-end' : 'left-start')}
        sideOffset={4}
        className={cn(popupClassName, 'w-100 rounded-2xl')}
      >
        <div className="relative px-3 pt-3.5 pb-1">
          <div className="pr-8 pl-1 system-xl-semibold text-text-primary">
            {t(($) => $['modelProvider.modelSettings'], { ns: 'common' })}
          </div>
          <PopoverClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                className="absolute top-2.5 right-2.5"
                size="lg"
                variant="default"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </div>
        <div className="max-h-105 overflow-y-auto">
          {trigger && (
            <div className="px-4 pt-2 pb-4">
              <ModelSelector
                value={hasSelectedModel ? { provider, model: modelId } : undefined}
                models={selectableModelList}
                disabled={modelSelectorReadonly}
                onValueChange={handleChangeModel}
                onHide={() => setOpen(false)}
              />
            </div>
          )}
          {!!parameterRules.length && (
            <div
              className={cn(
                'flex flex-col gap-2 px-4 pt-3 pb-4',
                trigger && 'border-t border-divider-subtle',
              )}
            >
              <div className="flex items-center gap-1">
                <div className="flex flex-1 items-center system-sm-semibold-uppercase text-text-secondary">
                  {t(($) => $['modelProvider.parameters'], { ns: 'common' })}
                </div>
                {PROVIDER_WITH_PRESET_TONE.includes(provider) && (
                  <PresetsParameter
                    onSelect={handleSelectPresetParameter}
                    supportedParameterNames={supportedPresetParameterNames}
                  />
                )}
              </div>
              {isRulesLoading ? (
                <div className="py-5">
                  <Loading />
                </div>
              ) : (
                [...parameterRules, ...(isAdvancedMode ? [STOP_PARAMETER_RULE] : [])].map(
                  (parameter) => (
                    <ParameterItem
                      key={`${modelId}-${parameter.name}`}
                      parameterRule={parameter}
                      value={completionParams?.[parameter.name]}
                      onChange={(v) => handleParamChange(parameter.name, v)}
                      onSwitch={(checked, assignValue) =>
                        handleSwitch(parameter.name, checked, assignValue)
                      }
                      isInWorkflow={isInWorkflow}
                      nodesOutputVars={nodesOutputVars}
                      availableNodes={availableNodes}
                    />
                  ),
                )
              )}
            </div>
          )}
          {!parameterRules.length && isRulesLoading && (
            <div className="px-4 py-5">
              <Loading />
            </div>
          )}
        </div>
        {!hideDebugWithMultipleModel && (
          <button
            type="button"
            className="flex h-12.5 cursor-pointer items-center justify-between rounded-b-xl border-t border-t-divider-subtle px-4 system-sm-regular text-text-accent"
            onClick={() => onDebugWithMultipleModelChange?.()}
          >
            {debugWithMultipleModel
              ? t(($) => $.debugAsSingleModel, { ns: 'appDebug' })
              : t(($) => $.debugAsMultipleModel, { ns: 'appDebug' })}
            <ArrowNarrowLeft aria-hidden className="size-3 rotate-180" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default ModelParameterModal
