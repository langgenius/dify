import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC = () => {
  const { t } = useTranslation()
  // const readOnly = false

  const {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,

  } = useConfig(mockData)
  const model = inputs.model

  return (
    <div className='mt-2 px-4 space-y-4'>
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
    </div>
  )
}

export default Panel
