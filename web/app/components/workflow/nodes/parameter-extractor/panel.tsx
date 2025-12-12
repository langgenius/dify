import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Editor from '../_base/components/prompt/editor'
import ConfigVision from '../_base/components/config-vision'
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
import type { NodePanelProps } from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'
import { VarType } from '@/app/components/workflow/types'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import { SimpleSelect } from '@/app/components/base/select'
import type { Item as SelectItem } from '@/app/components/base/select'
import useSWR from 'swr'
import { fetchAvailableCredentials } from '@/service/common'

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
    isVisionModel,
    handleVisionResolutionChange,
    handleVisionResolutionEnabledChange,
    handleCredentialOverrideChange,
  } = useConfig(id, data)

  const model = inputs.model

  // available credentials for override select
  const providerForCreds = model?.provider
  const modelNameForCreds = model?.name
  const { data: availableCreds, isLoading: credsLoading } = useSWR(
    providerForCreds ? `/workspaces/current/model-providers/${providerForCreds}/available-credentials${modelNameForCreds ? `?model=${encodeURIComponent(modelNameForCreds)}&model_type=llm` : ''}` : null,
    fetchAvailableCredentials,
  )
  const overrideItems: SelectItem[] = React.useMemo(() => {
    const list = [
      ...((availableCreds?.provider_available_credentials || []).map(c => ({ value: c.credential_id, name: c.credential_name || c.credential_id })) as SelectItem[]),
      ...((availableCreds?.model_available_credentials || []).map(c => ({ value: c.credential_id, name: c.credential_name || c.credential_id })) as SelectItem[]),
    ]
    const seen = new Set<string>()
    const deduped = list.filter((it) => {
      const v = String(it.value)
      if (seen.has(v)) return false
      seen.add(v)
      return true
    })
    // Add explicit option label to allow resetting to default credentials
    return [{ value: '', name: t('common.label.noOverride') }, ...deduped]
  }, [availableCreds, t])

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
        {model?.provider && !readOnly && (
          <Field
            title={t('API keys')}
            tooltip={t(`${i18nPrefix} credential override`)!}
          >
            <div className='space-y-2'>
              <SimpleSelect
                items={overrideItems}
                defaultValue={inputs.model?.credential_override?.credential_id || ''}
                onSelect={(item) => {
                  const v = String(item.value || '')
                  handleCredentialOverrideChange(v
                    ? { credential_id: v, credential_name: undefined }
                    : undefined,
                  )
                }}
                isLoading={credsLoading}
                notClearable={false}
                className="system-sm-regular h-8 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-2 hover:bg-state-base-hover-alt"
                wrapperClassName="h-8"
                optionClassName="system-sm-regular"
              />
              <div className='text-xs text-text-tertiary'>
                {t('override the credential')}
              </div>
            </div>
          </Field>
        )}
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
                description={t(`${i18nPrefix}.outputVars.isSuccess`)}
              />
              <VarItem
                name='__reason'
                type={VarType.string}
                description={t(`${i18nPrefix}.outputVars.errorReason`)}
              />
              <VarItem
                name='__usage'
                type='object'
                description={t(`${i18nPrefix}.outputVars.usage`)}
              />
            </>
          </OutputVars>
        </div>
      </>)}
    </div>
  )
}

export default React.memo(Panel)
