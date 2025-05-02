import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Editor from '../_base/components/prompt/editor'
import ResultPanel from '../../run/result-panel'
import ConfigVision from '../_base/components/config-vision'
import { findVariableWhenOnLLMVision } from '../utils'
import useConfig from './use-config'
import type { ParameterExtractorNodeType } from './types'
import ExtractParameter from './components/extract-parameter/list'
import ImportFromTool from './components/extract-parameter/import-from-tool'
import AddExtractParameter from './components/extract-parameter/update'
import ReasoningModePicker from './components/reasoning-mode-picker'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { InputVarType, type NodePanelProps } from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import { VarType } from '@/app/components/workflow/types'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'

const i18nPrefix = 'workflow.nodes.parameterExtractor'
const i18nCommonPrefix = 'workflow.common'

const Panel: FC<NodePanelProps<ParameterExtractorNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleInputVarChange,
    filterVar,
    isChatModel,
    isChatMode,
    isCompletionModel,
    handleModelChanged,
    handleImportFromTool,
    handleCompletionParamsChange,
    addExtractParameter,
    handleExactParamsChange,
    handleInstructionChange,
    hasSetBlockStatus,
    handleMemoryChange,
    isSupportFunctionCall,
    handleReasoningModeChange,
    availableVars,
    availableNodesWithParent,
    availableVisionVars,
    inputVarValues,
    varInputs,
    isVisionModel,
    handleVisionResolutionChange,
    handleVisionResolutionEnabledChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    setInputVarValues,
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
          values: { '#files#': visionFiles },
          onChange: keyValue => setVisionFiles((keyValue as any)['#files#']),
        },
      )
    }

    return forms
  })()

  return (
    <div className='pt-2'>
      <div className='space-y-4 px-4'>
        <Field
          title={t(`${i18nCommonPrefix}.model`)}
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
            setModel={handleModelChanged}
            onCompletionParamsChange={handleCompletionParamsChange}
            hideDebugWithMultipleModel
            debugWithMultipleModel={false}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.inputVar`)}
          required
        >
          <>
            <VarReferencePicker
              readonly={readOnly}
              nodeId={id}
              isShowNodeName
              value={inputs.query || []}
              onChange={handleInputVarChange}
              filterVar={filterVar}
            />
          </>
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
          title={t(`${i18nPrefix}.extractParameters`)}
          required
          operations={
            !readOnly
              ? (
                <div className='flex items-center space-x-1'>
                  {!readOnly && (
                    <ImportFromTool onImport={handleImportFromTool} />
                  )}
                  {!readOnly && (<div className='h-3 w-px bg-divider-regular'></div>)}
                  <AddExtractParameter type='add' onSave={addExtractParameter} />
                </div>
              )
              : undefined
          }
        >
          <ExtractParameter
            readonly={readOnly}
            list={inputs.parameters || []}
            onChange={handleExactParamsChange}
          />
        </Field>
        <Editor
          title={
            <div className='flex items-center space-x-1'>
              <span className='uppercase'>{t(`${i18nPrefix}.instruction`)}</span>
              <Tooltip
                popupContent={
                  <div className='w-[120px]'>
                    {t(`${i18nPrefix}.instructionTip`)}
                  </div>
                }
                triggerClassName='w-3.5 h-3.5 ml-0.5'
              />
            </div>
          }
          value={inputs.instruction}
          onChange={handleInstructionChange}
          readOnly={readOnly}
          isChatModel={isChatModel}
          isChatApp={isChatMode}
          isShowContext={false}
          hasSetBlockStatus={hasSetBlockStatus}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
        />
      </div>
      <FieldCollapse title={t(`${i18nPrefix}.advancedSetting`)}>
        <>
          {/* Memory */}
          {isChatMode && (
            <div className='mt-4'>
              <MemoryConfig
                readonly={readOnly}
                config={{ data: inputs.memory }}
                onChange={handleMemoryChange}
                canSetRoleName={isCompletionModel}
              />
            </div>
          )}
          {isSupportFunctionCall && (
            <div className='mt-2'>
              <ReasoningModePicker
                type={inputs.reasoning_mode}
                onChange={handleReasoningModeChange}
              />
            </div>
          )}
        </>
      </FieldCollapse>
      {inputs.parameters?.length > 0 && (<>
        <Split />
        <div>
          <OutputVars>
            <>
              {inputs.parameters.map((param, index) => (
                <VarItem
                  key={index}
                  name={param.name}
                  type={param.type}
                  description={param.description}
                />
              ))}
              <VarItem
                name='__is_success'
                type={VarType.number}
                description={t(`${i18nPrefix}.isSuccess`)}
              />
              <VarItem
                name='__reason'
                type={VarType.string}
                description={t(`${i18nPrefix}.errorReason`)}
              />
            </>
          </OutputVars>
        </div>
      </>)}
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
