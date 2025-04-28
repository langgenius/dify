import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigVision from '../_base/components/config-vision'
import useConfig from './use-config'
import { findVariableWhenOnLLMVision } from '../utils'
import type { LLMNodeType } from './types'
import ConfigPrompt from './components/config-prompt'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import AddButton2 from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import Tooltip from '@/app/components/base/tooltip'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import StructureOutput from './components/structure-output'
import Switch from '@/app/components/base/switch'
import { RiAlertFill, RiQuestionLine } from '@remixicon/react'

const i18nPrefix = 'workflow.nodes.llm'

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
    isShowSingleRun,
    hideSingleRun,
    inputVarValues,
    setInputVarValues,
    visionFiles,
    setVisionFiles,
    contexts,
    setContexts,
    runningStatus,
    isModelSupportStructuredOutput,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    handleStructureOutputEnableChange,
    handleStructureOutputChange,
    handleRun,
    handleStop,
    varInputs,
    runResult,
    filterJinjia2InputVar,
  } = useConfig(id, data)

  const model = inputs.model

  const singleRunForms = (() => {
    const forms: FormProps[] = []

    if (varInputs.length > 0) {
      forms.push(
        {
          label: t(`${i18nPrefix}.singleRun.variable`)!,
          inputs: varInputs,
          values: inputVarValues,
          onChange: setInputVarValues,
        },
      )
    }

    if (inputs.context?.variable_selector && inputs.context?.variable_selector.length > 0) {
      forms.push(
        {
          label: t(`${i18nPrefix}.context`)!,
          inputs: [{
            label: '',
            variable: '#context#',
            type: InputVarType.contexts,
            required: false,
          }],
          values: { '#context#': contexts },
          onChange: keyValue => setContexts(keyValue['#context#']),
        },
      )
    }

    if (isVisionModel && data.vision?.enabled && data.vision?.configs?.variable_selector) {
      const currentVariable = findVariableWhenOnLLMVision(data.vision.configs.variable_selector, availableVars)

      forms.push(
        {
          label: t(`${i18nPrefix}.vision`)!,
          inputs: [{
            label: currentVariable?.variable as any,
            variable: '#files#',
            type: currentVariable?.formType as any,
            required: false,
          }],
          values: { '#files#': visionFiles },
          onChange: keyValue => setVisionFiles((keyValue as any)['#files#']),
        },
      )
    }

    return forms
  })()

  const handleModelChange = useCallback((model: {
    provider: string
    modelId: string
    mode?: string
  }) => {
    handleCompletionParamsChange({})
    handleModelChanged(model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
          required
        >
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isInWorkflow
            isAdvancedMode={true}
            mode={model?.mode}
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
          title={t(`${i18nPrefix}.context`)}
          tooltip={t(`${i18nPrefix}.contextTooltip`)!}
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
              <div className='text-xs font-normal leading-[18px] text-[#DC6803]'>{t(`${i18nPrefix}.notSetContextInPromptTip`)}</div>
            )}
          </>
        </Field>

        {/* Prompt */}
        {model.name && (
          <ConfigPrompt
            readOnly={readOnly}
            nodeId={id}
            filterVar={filterInputVar}
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
            title={t('workflow.nodes.templateTransform.inputVars')}
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
              filterVar={filterJinjia2InputVar}
              isSupportFileVar={false}
            />
          </Field>
        )}

        {/* Memory put place examples. */}
        {isChatMode && isChatModel && !!inputs.memory && (
          <div className='mt-4'>
            <div className='flex h-8 items-center justify-between rounded-lg bg-components-input-bg-normal pl-3 pr-2'>
              <div className='flex items-center space-x-1'>
                <div className='text-xs font-semibold uppercase text-text-secondary'>{t('workflow.nodes.common.memories.title')}</div>
                <Tooltip
                  popupContent={t('workflow.nodes.common.memories.tip')}
                  triggerClassName='w-4 h-4'
                />
              </div>
              <div className='flex h-[18px] items-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 text-xs font-semibold uppercase text-text-tertiary'>{t('workflow.nodes.common.memories.builtIn')}</div>
            </div>
            {/* Readonly User Query */}
            <div className='mt-4'>
              <Editor
                title={<div className='flex items-center space-x-1'>
                  <div className='text-xs font-semibold uppercase text-text-secondary'>user</div>
                  <Tooltip
                    popupContent={
                      <div className='max-w-[180px]'>{t('workflow.nodes.llm.roleDescription.user')}</div>
                    }
                    triggerClassName='w-4 h-4'
                  />
                </div>}
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
                <div className='text-xs font-normal leading-[18px] text-[#DC6803]'>{t(`${i18nPrefix}.sysQueryInUser`)}</div>
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
      </div>
      <Split />
      <OutputVars
        collapsed={structuredOutputCollapsed}
        onCollapse={setStructuredOutputCollapsed}
        operations={
          <div className='mr-4 flex shrink-0 items-center'>
            {(!isModelSupportStructuredOutput && !!inputs.structured_output_enabled) && (
              <Tooltip noDecoration popupContent={
                <div className='w-[232px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg backdrop-blur-[5px]'>
                  <div className='title-xs-semi-bold text-text-primary'>{t('app.structOutput.modelNotSupported')}</div>
                  <div className='body-xs-regular mt-1 text-text-secondary'>{t('app.structOutput.modelNotSupportedTip')}</div>
                </div>
              }>
                <div>
                  <RiAlertFill className='mr-1 size-4 text-text-warning-secondary' />
                </div>
              </Tooltip>
            )}
            <div className='system-xs-medium-uppercase mr-0.5 text-text-tertiary'>{t('app.structOutput.structured')}</div>
            <Tooltip popupContent={
              <div className='max-w-[150px]'>{t('app.structOutput.structuredTip')}</div>
            }>
              <div>
                <RiQuestionLine className='size-3.5 text-text-quaternary' />
              </div>
            </Tooltip>
            <Switch
              className='ml-2'
              defaultValue={!!inputs.structured_output_enabled}
              onChange={handleStructureOutputEnableChange}
              size='md'
              disabled={readOnly}
            />
          </div>
        }
      >
        <>
          <VarItem
            name='text'
            type='string'
            description={t(`${i18nPrefix}.outputVars.output`)}
          />
          {inputs.structured_output_enabled && (
            <>
              <Split className='mt-3' />
              <StructureOutput
                className='mt-4'
                value={inputs.structured_output}
                onChange={handleStructureOutputChange}
              />
            </>
          )}
        </>
      </OutputVars>
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          nodeType={inputs.type}
          onHide={hideSingleRun}
          forms={singleRunForms}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          result={<ResultPanel {...runResult} showSteps={false} />}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
