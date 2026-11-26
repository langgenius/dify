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
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { editorResourceKindAtom } from '@/app/components/workflow/editor-resource/state'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import FormInputTypeSwitch from '@/app/components/workflow/nodes/_base/components/form-input-type-switch'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import {
  fetchAndMergeValidCompletionParams,
  fetchModelParameterRulesForModel,
  formatRemovedCompletionParams,
} from '@/utils/completion-params'
import { getErrorMessage } from '@/utils/error-message'
import { extractPluginId } from '../../utils/plugin'
import ConfigVision from '../_base/components/config-vision'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigPrompt from './components/config-prompt'
import PanelMemorySection from './components/panel-memory-section'
import PanelOutputSection from './components/panel-output-section'
import ReasoningFormatConfig from './components/reasoning-format-config'
import useConfig from './use-config'
import {
  getLLMEnvironmentModel,
  getLLMModelIssue,
  getModelSelectionKey,
  LLMModelIssueCode,
} from './utils'

const i18nPrefix = 'nodes.llm'

const getRemovedParametersForWarning = async (
  previousModel: LLMNodeType['model'],
  removedDetails: Record<string, string>,
) => {
  const removed = Object.entries(removedDetails)
  if (
    !previousModel.provider ||
    !previousModel.name ||
    !removed.some(([, reason]) => reason === 'unsupported')
  )
    return removed

  const previousRules = await fetchModelParameterRulesForModel(
    previousModel.provider,
    previousModel.name,
    { silent: true },
  ).catch(() => [])
  // An empty response can also mean the previous model's rules are unavailable.
  if (!previousRules.length) return removed

  return removed.filter(
    ([name, reason]) =>
      reason !== 'unsupported' ||
      previousRules.some((rule) => rule.name === name || rule.use_template === name),
  )
}

const Panel: FC<NodePanelProps<LLMNodeType>> = ({ id, data }) => {
  const { t } = useTranslation(['common', 'workflow', 'modelProvider', 'workflowModels'])
  const resourceKind = useAtomValue(editorResourceKindAtom)
  const workflowStore = useWorkflowStore()
  const {
    readOnly,
    inputs,
    model,
    environmentVariables,
    isEnvironmentModelSource,
    isChatModel,
    isChatflow,
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

  const isProviderRequired =
    getLLMModelIssue({ modelProvider: model?.provider }) === LLMModelIssueCode.providerRequired
  const { data: isModelProviderInstalled = isProviderRequired } = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions({
      select: (response) =>
        isProviderRequired ||
        response.data.some(
          (provider) => extractPluginId(provider.provider) === extractPluginId(model.provider),
        ),
    }),
  )
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
  useLayoutEffect(() => {
    modelSelectionKeyRef.current = modelSelectionKey
  }, [modelSelectionKey])

  const handleModelChange = useCallback(
    async (
      nextModel: { provider: string; modelId: string; mode?: string },
      environmentVariableName?: string,
    ) => {
      const baselineSelectionKey = modelSelectionKeyRef.current
      const requestGeneration = ++modelSelectionRequestGenerationRef.current
      const environmentSelector = environmentVariableName ? ['env', environmentVariableName] : null
      const targetEnvironmentModel = environmentSelector
        ? getLLMEnvironmentModel(environmentSelector, environmentVariables)
        : undefined
      const isCurrentRequest = () =>
        modelSelectionRequestGenerationRef.current === requestGeneration &&
        modelSelectionKeyRef.current === baselineSelectionKey &&
        (!environmentSelector ||
          getLLMEnvironmentModel(
            environmentSelector,
            workflowStore.getState().environmentVariables,
          ) === targetEnvironmentModel)
      try {
        const { params, removedDetails } = await fetchAndMergeValidCompletionParams(
          nextModel.provider,
          nextModel.modelId,
          inputs.model.completion_params,
          true,
        )
        if (!isCurrentRequest()) return
        const removed = await getRemovedParametersForWarning(inputs.model, removedDetails)
        if (!isCurrentRequest()) return
        if (environmentSelector) handleModelSelectorChange(environmentSelector, params)
        else handleModelChanged(nextModel, params)
        if (removed.length)
          toast.warning(
            t(($) => $['modelProvider.parametersInvalidRemoved'], {
              ns: 'modelProvider',
              parameters: formatRemovedCompletionParams(removed),
            }),
          )
      } catch (error) {
        if (isCurrentRequest())
          toast.error(getErrorMessage(error) ?? t(($) => $.error, { ns: 'common' }))
      }
    },
    [
      environmentVariables,
      handleModelChanged,
      handleModelSelectorChange,
      inputs.model,
      t,
      workflowStore,
    ],
  )

  const llmEnvironmentVariables = environmentVariables.filter(
    (variable) => variable.value_type === 'llm',
  )

  const handleEnvironmentModelChange = useCallback(
    (environmentVariableName: string) => {
      const modelSelector = ['env', environmentVariableName]
      const selectedModel = getLLMEnvironmentModel(modelSelector, environmentVariables)
      if (!selectedModel || selectedModel.completion_params !== undefined) {
        modelSelectionRequestGenerationRef.current++
        handleModelSelectorChange(modelSelector, selectedModel?.completion_params)
        return
      }
      void handleModelChange(
        { provider: selectedModel.provider, modelId: selectedModel.name },
        environmentVariableName,
      )
    },
    [environmentVariables, handleModelChange, handleModelSelectorChange],
  )

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(($) => $[`${i18nPrefix}.model`], { ns: 'workflowModels' })}
          required
          warningDot={hasModelWarning}
          operations={
            resourceKind === 'snippet' && !isEnvironmentModelSource ? undefined : (
              <FormInputTypeSwitch
                value={isEnvironmentModelSource ? VarKindType.variable : VarKindType.constant}
                readonly={readOnly}
                onChange={(value) => {
                  const useEnvironmentVariable = value === VarKindType.variable
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
                  aria-label={t(($) => $[`${i18nPrefix}.model`], { ns: 'workflowModels' })}
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
          title={t(($) => $[`${i18nPrefix}.context`], { ns: 'workflowModels' })}
          tooltip={t(($) => $[`${i18nPrefix}.contextTooltip`], { ns: 'workflowModels' })!}
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
              <div className="text-xs leading-4.5 font-normal text-[#DC6803]">
                {t(($) => $[`${i18nPrefix}.notSetContextInPromptTip`], { ns: 'workflowModels' })}
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
            isChatApp={isChatflow}
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

        {isChatflow && (
          <>
            <Split />
            <PanelMemorySection
              readOnly={readOnly}
              isChatflow={isChatflow}
              isChatModel={isChatModel}
              isCompletionModel={isCompletionModel}
              inputs={inputs}
              hasSetBlockStatus={hasSetBlockStatus}
              availableVars={availableVars}
              availableNodesWithParent={availableNodesWithParent}
              resourceKind={resourceKind}
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
