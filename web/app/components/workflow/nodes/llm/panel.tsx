import type { FC } from 'react'
import type { LLMNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import FormInputTypeSwitch from '@/app/components/workflow/nodes/_base/components/form-input-type-switch'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import { useProviderContextSelector } from '@/context/provider-context'
import { FlowType } from '@/types/common'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { extractPluginId } from '../../utils/plugin'
import ConfigVision from '../_base/components/config-vision'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import { VarType } from '../tool/types'
import ConfigPrompt from './components/config-prompt'
import PanelMemorySection from './components/panel-memory-section'
import PanelOutputSection from './components/panel-output-section'
import ReasoningFormatConfig from './components/reasoning-format-config'
import useConfig from './use-config'
import { getLLMEnvironmentModel, getLLMModelIssue, LLMModelIssueCode } from './utils'

const i18nPrefix = 'nodes.llm'

const getModelSelectionKey = (
  source: 'direct' | 'env',
  provider: string,
  modelName: string,
  completionParams: LLMNodeType['model']['completion_params'],
  environmentVariableName = '',
) =>
  `${source}:${environmentVariableName}:${provider}:${modelName}:${JSON.stringify(completionParams)}`

const Panel: FC<NodePanelProps<LLMNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const {
    readOnly,
    inputs,
    model,
    environmentVariables,
    isEnvironmentModelSource,
    isChatModel,
    isChatMode,
    isCompletionModel,
    shouldShowContextTip,
    isVisionModel,
    handleModelChanged,
    handleModelSourceChange,
    handleModelSelectorChange,
    hasSetBlockStatus,
    handleCompletionParamsChange,
    handleContextVarChange,
    filterInputVar,
    filterVar,
    availableVars,
    availableNodesWithParent,
    isShowVars,
    handlePromptChange,
    handleAddEmptyVariable,
    handleAddVariable,
    handleVarListChange,
    handleVarNameChange,
    handleSyeQueryChange,
    handleMemoryChange,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    isModelSupportStructuredOutput,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    handleStructureOutputEnableChange,
    handleStructureOutputChange,
    filterJinja2InputVar,
    handleReasoningFormatChange,
  } = useConfig(id, data)

  const isModelProviderInstalled = useProviderContextSelector((state) => {
    const modelIssue = getLLMModelIssue({ modelProvider: model?.provider })
    if (modelIssue === LLMModelIssueCode.providerRequired) return true

    const modelProviderPluginId = extractPluginId(model.provider)
    return state.modelProviders.some(
      (provider) => extractPluginId(provider.provider) === modelProviderPluginId,
    )
  })
  const hasModelWarning =
    getLLMModelIssue({
      modelProvider: model?.provider,
      isModelProviderInstalled,
    }) !== null
  const selectedEnvironmentVariableName = inputs.model_selector?.[1]
  const modelSelectionKey = getModelSelectionKey(
    isEnvironmentModelSource ? 'env' : 'direct',
    model.provider,
    model.name,
    model.completion_params,
    selectedEnvironmentVariableName,
  )
  const modelSelectionKeyRef = useRef(modelSelectionKey)
  const modelSelectionRequestGenerationRef = useRef(0)
  modelSelectionKeyRef.current = modelSelectionKey

  const handleModelChange = useCallback(
    (model: { provider: string; modelId: string; mode?: string }) => {
      const baselineSelectionKey = modelSelectionKeyRef.current
      const requestGeneration = ++modelSelectionRequestGenerationRef.current
      ;(async () => {
        try {
          const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
            model.provider,
            model.modelId,
            inputs.model.completion_params,
            true,
          )
          if (
            modelSelectionRequestGenerationRef.current !== requestGeneration ||
            modelSelectionKeyRef.current !== baselineSelectionKey
          )
            return
          const keys = Object.keys(removedDetails)
          if (keys.length)
            toast.warning(
              `${t(($) => $['modelProvider.parametersInvalidRemoved'], { ns: 'common' })}: ${keys.map((k) => `${k} (${removedDetails[k]})`).join(', ')}`,
            )
          handleModelChanged(model, filtered)
        } catch {
          if (
            modelSelectionRequestGenerationRef.current !== requestGeneration ||
            modelSelectionKeyRef.current !== baselineSelectionKey
          )
            return
          toast.error(t(($) => $.error, { ns: 'common' }))
        }
      })()
    },
    [handleModelChanged, inputs.model.completion_params, t],
  )

  const llmEnvironmentVariables = environmentVariables.filter(
    (variable) => variable.value_type === 'llm',
  )

  const handleEnvironmentModelChange = useCallback(
    (environmentVariableName: string) => {
      const baselineSelectionKey = modelSelectionKeyRef.current
      const requestGeneration = ++modelSelectionRequestGenerationRef.current
      const modelSelector = ['env', environmentVariableName]
      const selectedModel = getLLMEnvironmentModel(modelSelector, environmentVariables)
      if (!selectedModel) {
        handleModelSelectorChange(modelSelector)
        return
      }
      if (selectedModel.completion_params !== undefined) {
        handleModelSelectorChange(modelSelector, selectedModel.completion_params)
        return
      }

      ;(async () => {
        try {
          const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
            selectedModel.provider,
            selectedModel.name,
            inputs.model.completion_params,
            true,
          )
          if (
            modelSelectionRequestGenerationRef.current !== requestGeneration ||
            modelSelectionKeyRef.current !== baselineSelectionKey
          )
            return
          const keys = Object.keys(removedDetails)
          if (keys.length)
            toast.warning(
              `${t(($) => $['modelProvider.parametersInvalidRemoved'], { ns: 'common' })}: ${keys.map((key) => `${key} (${removedDetails[key]})`).join(', ')}`,
            )
          handleModelSelectorChange(modelSelector, filtered)
        } catch {
          if (
            modelSelectionRequestGenerationRef.current !== requestGeneration ||
            modelSelectionKeyRef.current !== baselineSelectionKey
          )
            return
          toast.error(t(($) => $.error, { ns: 'common' }))
        }
      })()
    },
    [environmentVariables, handleModelSelectorChange, inputs.model, t],
  )

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(($) => $[`${i18nPrefix}.model`], { ns: 'workflow' })}
          required
          warningDot={hasModelWarning}
          operations={
            flowType === FlowType.snippet && !isEnvironmentModelSource ? undefined : (
              <FormInputTypeSwitch
                value={isEnvironmentModelSource ? VarType.variable : VarType.constant}
                readonly={readOnly}
                onChange={(value) => {
                  const useEnvironmentVariable = value === VarType.variable
                  if (useEnvironmentVariable === isEnvironmentModelSource) return
                  modelSelectionRequestGenerationRef.current++
                  handleModelSourceChange(useEnvironmentVariable)
                }}
              />
            )
          }
        >
          <div className="space-y-2">
            {isEnvironmentModelSource && (
              <Select
                value={selectedEnvironmentVariableName ?? null}
                disabled={readOnly}
                onValueChange={(nextValue) => nextValue && handleEnvironmentModelChange(nextValue)}
              >
                <SelectTrigger
                  aria-label={t(($) => $[`${i18nPrefix}.model`], { ns: 'workflow' })}
                  className="w-full"
                >
                  {selectedEnvironmentVariableName ??
                    t(($) => $['nodes.common.typeSwitch.variable'], { ns: 'workflow' })}
                </SelectTrigger>
                <SelectContent>
                  {llmEnvironmentVariables.map((variable) => (
                    <SelectItem key={variable.id} value={variable.name}>
                      <SelectItemText>{variable.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ModelParameterModal
              popupClassName="w-[387px]!"
              isInWorkflow
              isAdvancedMode={true}
              provider={model?.provider}
              completionParams={model?.completion_params}
              modelId={model?.name}
              setModel={handleModelChange}
              onCompletionParamsChange={handleCompletionParamsChange}
              hideDebugWithMultipleModel
              debugWithMultipleModel={false}
              readonly={readOnly || isEnvironmentModelSource}
              modelSelectorReadonly={isEnvironmentModelSource}
              nodesOutputVars={availableVars}
              availableNodes={availableNodesWithParent}
            />
          </div>
        </Field>

        {/* knowledge */}
        <Field
          title={t(($) => $[`${i18nPrefix}.context`], { ns: 'workflow' })}
          tooltip={t(($) => $[`${i18nPrefix}.contextTooltip`], { ns: 'workflow' })!}
        >
          <>
            <VarReferencePicker
              readonly={readOnly}
              nodeId={id}
              isShowNodeName
              value={inputs.context?.variable_selector || []}
              onChange={handleContextVarChange}
              filterVar={filterVar}
            />
            {shouldShowContextTip && (
              <div className="text-xs leading-[18px] font-normal text-[#DC6803]">
                {t(($) => $[`${i18nPrefix}.notSetContextInPromptTip`], { ns: 'workflow' })}
              </div>
            )}
          </>
        </Field>

        {/* Prompt */}
        {model.name && (
          <ConfigPrompt
            readOnly={readOnly}
            nodeId={id}
            filterVar={isShowVars ? filterJinja2InputVar : filterInputVar}
            isChatModel={isChatModel}
            isChatApp={isChatMode}
            isShowContext
            payload={inputs.prompt_template}
            onChange={handlePromptChange}
            hasSetBlockStatus={hasSetBlockStatus}
            varList={inputs.prompt_config?.jinja2_variables || []}
            handleAddVariable={handleAddVariable}
            modelConfig={model}
          />
        )}

        {isShowVars && (
          <Field
            title={t(($) => $['nodes.templateTransform.inputVars'], { ns: 'workflow' })}
            operations={
              !readOnly ? (
                <button
                  type="button"
                  aria-label={`${t(($) => $['operation.add'], { ns: 'common' })} ${t(($) => $['nodes.templateTransform.inputVars'], { ns: 'workflow' })}`}
                  className="cursor-pointer rounded-md border-none bg-transparent p-1 select-none hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  onClick={handleAddEmptyVariable}
                >
                  <span className="i-ri-add-line size-4 text-text-tertiary" aria-hidden="true" />
                </button>
              ) : undefined
            }
          >
            <VarList
              nodeId={id}
              readonly={readOnly}
              list={inputs.prompt_config?.jinja2_variables || []}
              onChange={handleVarListChange}
              onVarNameChange={handleVarNameChange}
              filterVar={filterJinja2InputVar}
              isSupportFileVar={false}
            />
          </Field>
        )}

        {isChatMode && (
          <>
            <Split />
            <PanelMemorySection
              readOnly={readOnly}
              isChatMode={isChatMode}
              isChatModel={isChatModel}
              isCompletionModel={isCompletionModel}
              inputs={inputs}
              hasSetBlockStatus={hasSetBlockStatus}
              availableVars={availableVars}
              availableNodesWithParent={availableNodesWithParent}
              flowType={flowType}
              handleSyeQueryChange={handleSyeQueryChange}
              handleMemoryChange={handleMemoryChange}
            />
          </>
        )}

        {/* Vision: GPT4-vision and so on */}
        <ConfigVision
          nodeId={id}
          readOnly={readOnly}
          isVisionModel={isVisionModel}
          enabled={inputs.vision?.enabled}
          onEnabledChange={handleVisionResolutionEnabledChange}
          config={inputs.vision?.configs}
          onConfigChange={handleVisionResolutionChange}
        />

        {/* Reasoning Format */}
        <ReasoningFormatConfig
          // Default to tagged for backward compatibility
          value={inputs.reasoning_format || 'tagged'}
          onChange={handleReasoningFormatChange}
          readonly={readOnly}
        />
      </div>
      <PanelOutputSection
        readOnly={readOnly}
        inputs={inputs}
        isModelSupportStructuredOutput={isModelSupportStructuredOutput}
        structuredOutputCollapsed={structuredOutputCollapsed}
        setStructuredOutputCollapsed={setStructuredOutputCollapsed}
        handleStructureOutputEnableChange={handleStructureOutputEnableChange}
        handleStructureOutputChange={handleStructureOutputChange}
      />
    </div>
  )
}

export default React.memo(Panel)
