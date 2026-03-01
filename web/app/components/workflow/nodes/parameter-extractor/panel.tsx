import type { FC } from 'react'
import type { ParameterExtractorNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { VarType } from '@/app/components/workflow/types'
import ConfigVision from '../_base/components/config-vision'
import MemoryConfig from '../_base/components/memory-config'
import Editor from '../_base/components/prompt/editor'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import ImportFromTool from './components/extract-parameter/import-from-tool'
import ExtractParameter from './components/extract-parameter/list'
import AddExtractParameter from './components/extract-parameter/update'
import ReasoningModePicker from './components/reasoning-mode-picker'
import useConfig from './use-config'

const i18nPrefix = 'nodes.parameterExtractor'
const i18nCommonPrefix = 'common'

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
    isVisionModel,
    handleVisionResolutionChange,
    handleVisionResolutionEnabledChange,
  } = useConfig(id, data)

  const model = inputs.model

  return (
    <div className="pt-2">
      <div className="space-y-4 px-4">
        <Field
          title={t(`${i18nCommonPrefix}.model`, { ns: 'workflow' })}
          required
        >
          <ModelParameterModal
            popupClassName="!w-[387px]"
            isInWorkflow
            isAdvancedMode={true}
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
          title={t(`${i18nPrefix}.inputVar`, { ns: 'workflow' })}
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
          title={t(`${i18nPrefix}.extractParameters`, { ns: 'workflow' })}
          required
          operations={
            !readOnly
              ? (
                  <div className="flex items-center space-x-1">
                    {!readOnly && (
                      <ImportFromTool onImport={handleImportFromTool} />
                    )}
                    {!readOnly && (<div className="h-3 w-px bg-divider-regular"></div>)}
                    <AddExtractParameter type="add" onSave={addExtractParameter} />
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
          title={(
            <div className="flex items-center space-x-1">
              <span className="uppercase">{t(`${i18nPrefix}.instruction`, { ns: 'workflow' })}</span>
              <Tooltip
                popupContent={(
                  <div className="w-[120px]">
                    {t(`${i18nPrefix}.instructionTip`, { ns: 'workflow' })}
                  </div>
                )}
                triggerClassName="w-3.5 h-3.5 ml-0.5"
              />
            </div>
          )}
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
      <FieldCollapse title={t(`${i18nPrefix}.advancedSetting`, { ns: 'workflow' })}>
        <>
          {/* Memory */}
          {isChatMode && (
            <div className="mt-4">
              <MemoryConfig
                readonly={readOnly}
                config={{ data: inputs.memory }}
                onChange={handleMemoryChange}
                canSetRoleName={isCompletionModel}
              />
            </div>
          )}
          {isSupportFunctionCall && (
            <div className="mt-2">
              <ReasoningModePicker
                type={inputs.reasoning_mode}
                onChange={handleReasoningModeChange}
              />
            </div>
          )}
        </>
      </FieldCollapse>
      {inputs.parameters?.length > 0 && (
        <>
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
                  name="__is_success"
                  type={VarType.number}
                  description={t(`${i18nPrefix}.outputVars.isSuccess`, { ns: 'workflow' })}
                />
                <VarItem
                  name="__reason"
                  type={VarType.string}
                  description={t(`${i18nPrefix}.outputVars.errorReason`, { ns: 'workflow' })}
                />
                <VarItem
                  name="__usage"
                  type="object"
                  description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
                />
              </>
            </OutputVars>
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(Panel)
