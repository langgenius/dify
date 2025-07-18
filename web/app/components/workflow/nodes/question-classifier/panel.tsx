import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ConfigVision from '../_base/components/config-vision'
import useConfig from './use-config'
import ClassList from './components/class-list'
import AdvancedSetting from './components/advanced-setting'
import type { QuestionClassifierNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'

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
    handleMemoryChange,
    isVisionModel,
    handleVisionResolutionChange,
    handleVisionResolutionEnabledChange,
    filterVar,
    handleSortTopic,
  } = useConfig(id, data)

  const model = inputs.model

  return (
    <div className='pt-2'>
      <div className='space-y-4 px-4'>
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
          required
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
          required
        >
          <ClassList
            nodeId={id}
            list={inputs.classes}
            onChange={handleTopicsChange}
            readonly={readOnly}
            filterVar={filterVar}
            handleSortTopic={handleSortTopic}
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
            <VarItem
              name='usage'
              type='object'
              description={t(`${i18nPrefix}.outputVars.usage`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
