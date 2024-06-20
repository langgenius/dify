import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiQuestionLine } from '@remixicon/react'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import ResolutionPicker from './components/resolution-picker'
import type { LLMNodeType } from './types'
import ConfigPrompt from './components/config-prompt'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import AddButton2 from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { Resolution } from '@/types/app'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import Switch from '@/app/components/base/switch'
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
    isShowVisionConfig,
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
    handleRun,
    handleStop,
    varInputs,
    runResult,
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
          onChange: keyValue => setContexts((keyValue as any)['#context#']),
        },
      )
    }

    if (isShowVisionConfig) {
      forms.push(
        {
          label: t(`${i18nPrefix}.vision`)!,
          inputs: [{
            label: t(`${i18nPrefix}.files`)!,
            variable: '#files#',
            type: InputVarType.files,
            required: false,
          }],
          values: { '#files#': visionFiles },
          onChange: keyValue => setVisionFiles((keyValue as any)['#files#']),
        },
      )
    }

    return forms
  })()

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
        >
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isInWorkflow
            isAdvancedMode={true}
            mode={model?.mode}
            provider={model?.provider}
            completionParams={model?.completion_params}
            modelId={model?.name}
            setModel={handleModelChanged}
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
              <div className='leading-[18px] text-xs font-normal text-[#DC6803]'>{t(`${i18nPrefix}.notSetContextInPromptTip`)}</div>
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
              filterVar={filterVar}
            />
          </Field>
        )}

        {/* Memory put place examples. */}
        {isChatMode && isChatModel && !!inputs.memory && (
          <div className='mt-4'>
            <div className='flex justify-between items-center h-8 pl-3 pr-2 rounded-lg bg-gray-100'>
              <div className='flex items-center space-x-1'>
                <div className='text-xs font-semibold text-gray-700 uppercase'>{t('workflow.nodes.common.memories.title')}</div>
                <TooltipPlus
                  popupContent={t('workflow.nodes.common.memories.tip')}
                >
                  <RiQuestionLine className='w-3.5 h-3.5 text-gray-400' />
                </TooltipPlus>
              </div>
              <div className='flex items-center h-[18px] px-1 rounded-[5px] border border-black/8 text-xs font-semibold text-gray-500 uppercase'>{t('workflow.nodes.common.memories.builtIn')}</div>
            </div>
            {/* Readonly User Query */}
            <div className='mt-4'>
              <Editor
                title={<div className='flex items-center space-x-1'>
                  <div className='text-xs font-semibold text-gray-700 uppercase'>user</div>
                  <TooltipPlus
                    popupContent={
                      <div className='max-w-[180px]'>{t('workflow.nodes.llm.roleDescription.user')}</div>
                    }
                  >
                    <RiQuestionLine className='w-3.5 h-3.5 text-gray-400' />
                  </TooltipPlus>
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
              />

              {inputs.memory.query_prompt_template && !inputs.memory.query_prompt_template.includes('{{#sys.query#}}') && (
                <div className='leading-[18px] text-xs font-normal text-[#DC6803]'>{t(`${i18nPrefix}.sysQueryInUser`)}</div>
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
        {isShowVisionConfig && (
          <>
            <Split />
            <Field
              title={t(`${i18nPrefix}.vision`)}
              tooltip={t('appDebug.vision.description')!}
              operations={
                <Switch size='md' defaultValue={inputs.vision.enabled} onChange={handleVisionResolutionEnabledChange} />
              }
            >
              {inputs.vision.enabled
                ? (
                  <ResolutionPicker
                    value={inputs.vision.configs?.detail || Resolution.high}
                    onChange={handleVisionResolutionChange}
                  />
                )
                : null}

            </Field>
          </>
        )}
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='text'
              type='string'
              description={t(`${i18nPrefix}.outputVars.output`)}
            />
          </>
        </OutputVars>
      </div>
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
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
