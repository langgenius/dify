import type { FC } from 'react'
import type { LLMNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import { useProviderContextSelector } from '@/context/provider-context'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { extractPluginId } from '../../utils/plugin'
import ConfigVision from '../_base/components/config-vision'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigPrompt from './components/config-prompt'
import PanelMemorySection from './components/panel-memory-section'
import PanelOutputSection from './components/panel-output-section'
import ReasoningFormatConfig from './components/reasoning-format-config'
import useConfig from './use-config'
import { getLLMModelIssue, LLMModelIssueCode } from './utils'

const i18nPrefix = 'nodes.llm'

const Panel: FC<NodePanelProps<LLMNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    isChatModel,
    isChatMode,
    isCompletionModel,
    shouldShowContextTip,
    isVisionModel,
    handleModelChanged,
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

  const model = inputs.model
  const isModelProviderInstalled = useProviderContextSelector((state) => {
    const modelIssue = getLLMModelIssue({ modelProvider: model?.provider })
    if (modelIssue === LLMModelIssueCode.providerRequired)
      return true

    const modelProviderPluginId = extractPluginId(model.provider)
    return state.modelProviders.some(provider => extractPluginId(provider.provider) === modelProviderPluginId)
  })
  const hasModelWarning = getLLMModelIssue({
    modelProvider: model?.provider,
    isModelProviderInstalled,
  }) !== null

  const handleModelChange = useCallback((model: {
    provider: string
    modelId: string
    mode?: string
  }) => {
    (async () => {
      try {
        const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
          model.provider,
          model.modelId,
          inputs.model.completion_params,
          true,
        )
        const keys = Object.keys(removedDetails)
        if (keys.length)
          toast.warning(`${t('modelProvider.parametersInvalidRemoved', { ns: 'common' })}: ${keys.map(k => `${k} (${removedDetails[k]})`).join(', ')}`)
        handleCompletionParamsChange(filtered)
      }
      catch {
        toast.error(t('error', { ns: 'common' }))
        handleCompletionParamsChange({})
      }
      finally {
        handleModelChanged(model)
      }
    })()
  }, [handleCompletionParamsChange, handleModelChanged, inputs.model.completion_params, t])

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.model`, { ns: 'workflow' })}
          required
          warningDot={hasModelWarning}
        >
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
            readonly={readOnly}
            nodesOutputVars={availableVars}
            availableNodes={availableNodesWithParent}
          />
        </Field>

        {/* knowledge */}
        <Field
          title={t(`${i18nPrefix}.context`, { ns: 'workflow' })}
          tooltip={t(`${i18nPrefix}.contextTooltip`, { ns: 'workflow' })!}
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
              <div className="text-xs leading-[18px] font-normal text-[#DC6803]">{t(`${i18nPrefix}.notSetContextInPromptTip`, { ns: 'workflow' })}</div>
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
            title={t('nodes.templateTransform.inputVars', { ns: 'workflow' })}
            operations={
              !readOnly
                ? (
                    <div className="cursor-pointer rounded-md p-1 select-none hover:bg-state-base-hover" onClick={handleAddEmptyVariable} data-testid="add-button">
                      <span className="i-ri-add-line h-4 w-4 text-text-tertiary" />
                    </div>
                  )
                : undefined
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
