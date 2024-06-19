import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
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
    handleInstructionChange,
    inputVarValues,
    varInputs,
    setInputVarValues,
    handleMemoryChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    filterVar,
  } = useConfig(id, data)

  const model = inputs.model

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
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
          title={t(`${i18nPrefix}.class`)}
        >
          <ClassList
            id={id}
            list={inputs.classes}
            onChange={handleTopicsChange}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.advancedSetting`)}
          supportFold
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
        </Field>
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
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
          forms={[
            {
              inputs: [{
                label: t(`${i18nPrefix}.inputVars`)!,
                variable: 'query',
                type: InputVarType.paragraph,
                required: true,
              }, ...varInputs],
              values: inputVarValues,
              onChange: setInputVarValues,
            },
          ]}
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
