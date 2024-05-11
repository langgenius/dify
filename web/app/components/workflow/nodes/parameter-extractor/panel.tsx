import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../_base/components/memory-config'
import useConfig from './use-config'
import type { ParameterExtractorNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodePanelProps } from '@/app/components/workflow/types'
const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC<NodePanelProps<ParameterExtractorNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    isChatModel,
    isChatMode,
    isCompletionModel,
    handleCompletionParamsChange,
    handleMemoryChange,
  } = useConfig(id, data)

  // TODO: default value problem
  const model = {
    provider: '',
    name: '',
    mode: 'chat',
    completion_params: {
      temperature: 0.7,
    },
    ...inputs.model,
  }

  const handleModelChanged = () => { }

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
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
