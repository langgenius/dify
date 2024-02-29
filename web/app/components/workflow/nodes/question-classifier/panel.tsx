import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import { mockData } from './mock'
import ClassList from './components/class-list'
import AdvancedSetting from './components/advanced-setting'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
const i18nPrefix = 'workflow.nodes.questionClassifiers'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleQueryVarChange,
    handleTopicsChange,
    handleInstructionChange,
    handleMemoryChange,
  } = useConfig(mockData)
  const model = inputs.model

  return (
    <div className='mt-2 px-4 space-y-4'>
      <Field
        title={t(`${i18nPrefix}.inputVars`)}
      >
        <VarReferencePicker
          readonly={readOnly}
          isShowNodeName
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
          list={inputs.topics}
          onChange={handleTopicsChange} />
      </Field>
      <Field
        title={t(`${i18nPrefix}.advancedSetting`)}
      >
        <AdvancedSetting
          instruction={inputs.instruction}
          onInstructionChange={handleInstructionChange}
          memory={inputs.memory}
          onMemoryChange={handleMemoryChange}
        />
      </Field>
    </div>
  )
}

export default Panel
