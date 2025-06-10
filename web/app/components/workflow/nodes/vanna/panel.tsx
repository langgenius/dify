import React, {FC} from 'react'
import {useTranslation} from 'react-i18next'
import useConfig from './use-config'
import type {VannaNodeType} from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import {InputVarType, NodePanelProps} from '@/app/components/workflow/types'
import ModelParameterModal from "@/app/components/header/account-setting/model-provider-page/model-parameter-modal";
import VarReferencePicker from "@/app/components/workflow/nodes/_base/components/variable/var-reference-picker";
import BeforeRunForm from "@/app/components/workflow/nodes/_base/components/before-run-form";
import ResultPanel from "@/app/components/workflow/run/result-panel";
import type {Props as FormProps} from "@/app/components/workflow/nodes/_base/components/before-run-form/form";
import {findVariableWhenOnLLMVision} from "@/app/components/workflow/nodes/utils";
import Split from "@/app/components/workflow/nodes/_base/components/split";
import OutputVars, {VarItem} from "@/app/components/workflow/nodes/_base/components/output-vars";

const i18nPrefix = 'workflow.nodes.parameterExtractor'

const Panel: FC<NodePanelProps<VannaNodeType>> = (
  {
    id,
    data,
  }) => {
  const {t} = useTranslation()

  const {
    readOnly,
    inputs,
    handleCompletionParamsChange,
    handleInputVarChange,
    handleModelChanged,
    isShowSingleRun,
    hideSingleRun,
    handleRun,
    handleStop,
    runResult,
    runningStatus,
    filterVar,
    varInputs,
    inputVarValues,
    setInputVarValues,
    isVisionModel,
    availableVisionVars,
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
          label: t(`${i18nPrefix}.inputVar`)!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: true,
        }, ...varInputs],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    )

    if (isVisionModel && data.vision?.enabled && data.vision?.configs?.variable_selector) {
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
          values: {'#files#': visionFiles},
          onChange: keyValue => setVisionFiles((keyValue as any)['#files#']),
        },
      )
    }

    return forms
  })()


  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-4'>
        <Field
          title={'模型'}
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

        <Field
          title={'输入变量'}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.query || []}
            onChange={handleInputVarChange}
            filterVar={filterVar}
          />
        </Field>

      </div>
      <Split />
      <div>
        <OutputVars>
          <VarItem
            name='output'
            type='string'
            description={'查询出结果的数据'}
          />
          <VarItem
            name='sql'
            type='string'
            description={'生成的sql语句'}
          />
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
          result={<ResultPanel {...runResult} showSteps={false}/>}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
