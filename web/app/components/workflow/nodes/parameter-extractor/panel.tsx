import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import type { ParameterExtractorNodeType } from './types'
import ExtractParameter from './components/extract-parameter/list'
import ImportFromTool from './components/extract-parameter/import-from-tool'
import AddExtractParameter from './components/extract-parameter/add'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodePanelProps } from '@/app/components/workflow/types'

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
    handleCompletionParamsChange,
    handleExactParamsChange,
    handleMemoryChange,
  } = useConfig(id, data)

  const model = inputs.model

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVar`)}
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
        <Field
          title={t(`${i18nCommonPrefix}.model`)}
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
          title={t(`${i18nPrefix}.extractParameters`)}
          operations={
            !readOnly
              ? (
                <div className='flex items-center space-x-1'>
                  <ImportFromTool onImport={() => { }} />
                  {!readOnly && (<div className='w-px h-3 bg-gray-200'></div>)}
                  <AddExtractParameter onAdd={() => { }} />
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
    </div>
  )
}

export default React.memo(Panel)
