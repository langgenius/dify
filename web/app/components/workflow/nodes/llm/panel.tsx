import type { FC } from 'react'
import type { LLMNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { RiAlertFill, RiQuestionLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import AddButton2 from '@/app/components/base/button/add-button'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import ConfigVision from '../_base/components/config-vision'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigPrompt from './components/config-prompt'
import ReasoningFormatConfig from './components/reasoning-format-config'
import StructureOutput from './components/structure-output'
import useConfig from './use-config'

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
          Toast.notify({ type: 'warning', message: `${t('modelProvider.parametersInvalidRemoved', { ns: 'common' })}: ${keys.map(k => `${k} (${removedDetails[k]})`).join(', ')}` })
        handleCompletionParamsChange(filtered)
      }
      catch {
        Toast.notify({ type: 'error', message: t('error', { ns: 'common' }) })
        handleCompletionParamsChange({})
      }
      finally {
        handleModelChanged(model)
      }
    })()
  }, [inputs.model.completion_params])
  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.model`, { ns: 'workflow' })}
          required
        >
          <ModelParameterModal
            popupClassName="!w-[387px]"
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
              <div className="text-xs font-normal leading-[18px] text-[#DC6803]">{t(`${i18nPrefix}.notSetContextInPromptTip`, { ns: 'workflow' })}</div>
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
              !readOnly ? <AddButton2 onClick={handleAddEmptyVariable} /> : undefined
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

        {/* Memory put place examples. */}
        {isChatMode && isChatModel && !!inputs.memory && (
          <div className="mt-4">
            <div className="flex h-8 items-center justify-between rounded-lg bg-components-input-bg-normal pl-3 pr-2">
              <div className="flex items-center space-x-1">
                <div className="text-xs font-semibold uppercase text-text-secondary">{t('nodes.common.memories.title', { ns: 'workflow' })}</div>
                <Tooltip
                  popupContent={t('nodes.common.memories.tip', { ns: 'workflow' })}
                  triggerClassName="w-4 h-4"
                />
              </div>
              <div className="flex h-[18px] items-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 text-xs font-semibold uppercase text-text-tertiary">{t('nodes.common.memories.builtIn', { ns: 'workflow' })}</div>
            </div>
            {/* Readonly User Query */}
            <div className="mt-4">
              <Editor
                title={(
                  <div className="flex items-center space-x-1">
                    <div className="text-xs font-semibold uppercase text-text-secondary">user</div>
                    <Tooltip
                      popupContent={
                        <div className="max-w-[180px]">{t('nodes.llm.roleDescription.user', { ns: 'workflow' })}</div>
                      }
                      triggerClassName="w-4 h-4"
                    />
                  </div>
                )}
                value={inputs.memory.query_prompt_template || '{{#sys.query#}}'}
                onChange={handleSyeQueryChange}
                readOnly={readOnly}
                isShowContext={false}
                isChatApp
                isChatModel
                hasSetBlockStatus={hasSetBlockStatus}
                nodesOutputVars={availableVars}
                availableNodes={availableNodesWithParent}
                isSupportFileVar
              />

              {inputs.memory.query_prompt_template && !inputs.memory.query_prompt_template.includes('{{#sys.query#}}') && (
                <div className="text-xs font-normal leading-[18px] text-[#DC6803]">{t(`${i18nPrefix}.sysQueryInUser`, { ns: 'workflow' })}</div>
              )}
            </div>
          </div>
        )}

        {/* Memory */}
        {isChatMode && (
          <>
            <Split />
            <MemoryConfig
              readonly={readOnly}
              config={{ data: inputs.memory }}
              onChange={handleMemoryChange}
              canSetRoleName={isCompletionModel}
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
      <Split />
      <OutputVars
        collapsed={structuredOutputCollapsed}
        onCollapse={setStructuredOutputCollapsed}
        operations={(
          <div className="mr-4 flex shrink-0 items-center">
            {(!isModelSupportStructuredOutput && !!inputs.structured_output_enabled) && (
              <Tooltip
                noDecoration
                popupContent={(
                  <div className="w-[232px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg backdrop-blur-[5px]">
                    <div className="title-xs-semi-bold text-text-primary">{t('structOutput.modelNotSupported', { ns: 'app' })}</div>
                    <div className="body-xs-regular mt-1 text-text-secondary">{t('structOutput.modelNotSupportedTip', { ns: 'app' })}</div>
                  </div>
                )}
              >
                <div>
                  <RiAlertFill className="mr-1 size-4 text-text-warning-secondary" />
                </div>
              </Tooltip>
            )}
            <div className="system-xs-medium-uppercase mr-0.5 text-text-tertiary">{t('structOutput.structured', { ns: 'app' })}</div>
            <Tooltip popupContent={
              <div className="max-w-[150px]">{t('structOutput.structuredTip', { ns: 'app' })}</div>
            }
            >
              <div>
                <RiQuestionLine className="size-3.5 text-text-quaternary" />
              </div>
            </Tooltip>
            <Switch
              className="ml-2"
              defaultValue={!!inputs.structured_output_enabled}
              onChange={handleStructureOutputEnableChange}
              size="md"
              disabled={readOnly}
            />
          </div>
        )}
      >
        <>
          <VarItem
            name="text"
            type="string"
            description={t(`${i18nPrefix}.outputVars.output`, { ns: 'workflow' })}
          />
          <VarItem
            name="reasoning_content"
            type="string"
            description={t(`${i18nPrefix}.outputVars.reasoning_content`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
          />
          {inputs.structured_output_enabled && (
            <>
              <Split className="mt-3" />
              <StructureOutput
                className="mt-4"
                value={inputs.structured_output}
                onChange={handleStructureOutputChange}
              />
            </>
          )}
        </>
      </OutputVars>
    </div>
  )
}

export default React.memo(Panel)
