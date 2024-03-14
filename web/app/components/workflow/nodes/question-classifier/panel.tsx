import type { FC } from 'react'
import React, { useEffect } from 'react'
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
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

const Panel: FC<NodePanelProps<QuestionClassifierNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(1)

  const {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleQueryVarChange,
    handleTopicsChange,
    handleInstructionChange,
    handleMemoryChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    query,
    setQuery,
    runResult,
  } = useConfig(id, data)

  const model = inputs.model

  useEffect(() => {
    if (currentProvider?.provider && currentModel?.model && !model.provider) {
      handleModelChanged({
        provider: currentProvider?.provider,
        modelId: currentModel?.model,
      })
    }
  }, [model.provider, currentProvider, currentModel, handleModelChanged])

  return (
    <div>
      <div className='mt-2 px-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            isShowNodeName
            nodeId={id}
            value={inputs.query_variable_selector}
            onChange={handleQueryVarChange}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.model`)}
        >
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isAdvancedMode={true}
            mode={model?.mode}
            provider={model?.provider}
            completionParams={model.completion_params}
            modelId={model.name}
            setModel={handleModelChanged}
            onCompletionParamsChange={handleCompletionParamsChange}
            hideDebugWithMultipleModel
            debugWithMultipleModel={false}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.class`)}
        >
          <ClassList
            id={id}
            list={inputs.classes}
            onChange={handleTopicsChange} />
        </Field>
        <Field
          title={t(`${i18nPrefix}.advancedSetting`)}
          supportFold
        >
          <AdvancedSetting
            instruction={inputs.instruction}
            onInstructionChange={handleInstructionChange}
            memory={inputs.memory}
            onMemoryChange={handleMemoryChange}
          />
        </Field>
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
              }],
              values: { query },
              onChange: keyValue => setQuery((keyValue as any).query),
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
