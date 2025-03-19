import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigVision from '../_base/components/config-vision'
import { findVariableWhenOnLLMVision } from '../utils'
import useConfig from './use-config'
import ClassList from './components/class-list'
import AdvancedSetting from './components/advanced-setting'
import type { QuestionClassifierNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

const Panel: FC<NodePanelProps<QuestionClassifierNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleModelChanged,
    isChatMode,
    isChatModel,
    handleCompletionParamsChange,
    handleQueryVarChange,
    handleTopicsChange,
    hasSetBlockStatus,
    availableVars,
    availableNodesWithParent,
    availableVisionVars,
    handleInstructionChange,
    inputVarValues,
    varInputs,
    setInputVarValues,
    handleMemoryChange,
    isVisionModel,
    handleVisionResolutionChange,
    handleVisionResolutionEnabledChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    filterVar,
    visionFiles,
    setVisionFiles,
  } = useConfig(id, data)

  const model = inputs.model

  const singleRunForms = (() => {
    const forms: FormProps[] = []

    forms.push(
      {
        label: t('workflow.nodes.llm.singleRun.variable')!,
        inputs: [{
          label: t(`${i18nPrefix}.inputVars`)!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: true,
        }, ...varInputs],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    )

    if (isVisionModel && data.vision.enabled && data.vision.configs?.variable_selector) {
      const currentVariable = findVariableWhenOnLLMVision(data.vision.configs.variable_selector, availableVisionVars)

      forms.push(
        {
          label: t('workflow.nodes.llm.vision')!,
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

  return (
    <div className='pt-2'>
      <div className='px-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
        >
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isInWorkflow
            isAdvancedMode={true}
            mode={model?.mode}
            provider={model?.provider}
            completionParams={model.completion_params}
            modelId={model.name}
            setModel={handleModelChanged}
            onCompletionParamsChange={handleCompletionParamsChange}
            hideDebugWithMultipleModel
            debugWithMultipleModel={false}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            isShowNodeName
            nodeId={id}
            value={inputs.query_variable_selector}
            onChange={handleQueryVarChange}
            filterVar={filterVar}
          />
        </Field>
        <Split />
        <ConfigVision
          nodeId={id}
          readOnly={readOnly}
          isVisionModel={isVisionModel}
          enabled={inputs.vision?.enabled}
          onEnabledChange={handleVisionResolutionEnabledChange}
          config={inputs.vision?.configs}
          onConfigChange={handleVisionResolutionChange}
        />
        <Field
          title={t(`${i18nPrefix}.class`)}
        >
          <ClassList
            id={id}
            list={inputs.classes}
            onChange={handleTopicsChange}
            readonly={readOnly}
          />
        </Field>
        <Split />
      </div>
      <FieldCollapse
        title={t(`${i18nPrefix}.advancedSetting`)}
      >
        <AdvancedSetting
          hideMemorySetting={!isChatMode}
          instruction={inputs.instruction}
          onInstructionChange={handleInstructionChange}
          memory={inputs.memory}
          onMemoryChange={handleMemoryChange}
          readonly={readOnly}
          isChatApp={isChatMode}
          isChatModel={isChatModel}
          hasSetBlockStatus={hasSetBlockStatus}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
        />
      </FieldCollapse>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name='class_name'
              type='string'
              description={t(`${i18nPrefix}.outputVars.className`)}
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
