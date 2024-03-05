import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import ResolutionPicker from './components/resolution-picker'
import type { LLMNodeType } from './types'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC<NodeProps<LLMNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    isShowVisionConfig,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    handleContextVarChange,
    handleMemoryChange,
    handleVisionResolutionChange,
  } = useConfig(id, data)

  const isChatApp = true // TODO: get from app context
  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'
  const isCompletionModel = !isChatModel

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
        >
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isAdvancedMode={true}
            mode={model?.mode}
            provider={model?.provider}
            completionParams={model?.completion_params}
            modelId={model?.name}
            setModel={handleModelChanged}
            onCompletionParamsChange={handleCompletionParamsChange}
            hideDebugWithMultipleModel
            debugWithMultipleModel={false}
          />
        </Field>

        <Field
          title={t(`${i18nPrefix}.variables`)}
          operations={
            <AddButton onClick={handleAddVariable} />
          }
        >
          <VarList
            readonly={readOnly}
            list={inputs.variables}
            onChange={handleVarListChange}
          />
        </Field>

        {/* knowledge */}
        <Field
          title={t(`${i18nPrefix}.context`)}
          tooltip={t(`${i18nPrefix}.contextTooltip`)!}
        >
          <VarReferencePicker
            readonly={readOnly}
            isShowNodeName
            value={inputs.context?.variable_selector || []}
            onChange={handleContextVarChange}
          />

        </Field>

        {/* Prompt */}
        <Field
          title={t(`${i18nPrefix}.prompt`)}
        >
          Prompt
        </Field>

        {/* Memory examples */}
        {isChatApp && isChatModel && (
          <div className='text-xs text-gray-300'>Memory examples(Designing)</div>
        )}
        {/* Memory */}
        {isChatApp && (
          <>
            <MemoryConfig
              readonly={readOnly}
              payload={inputs.memory}
              onChange={handleMemoryChange}
              canSetRoleName={isCompletionModel}
            />
            <Split />
          </>
        )}

        {/* Vision: GPT4-vision and so on */}
        {isShowVisionConfig && (
          <Field
            title={t(`${i18nPrefix}.vision`)}
            tooltip={t('appDebug.vision.description')!}
            operations={
              <ResolutionPicker
                value={inputs.vision.configs.detail}
                onChange={handleVisionResolutionChange}
              />
            }
          />
        )}
      </div>
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='output'
              type='string'
              description={t(`${i18nPrefix}.outputVars.output`)}
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
