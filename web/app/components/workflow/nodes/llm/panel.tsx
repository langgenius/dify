import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import BasePanel from '../_base/panel'
import VarList from '../_base/components/variable/var-list'
import useConfig from './use-config'
import { mockLLMNodeData } from './mock'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import Switch from '@/app/components/base/switch'

const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    toggleContextEnabled,
  } = useConfig(mockLLMNodeData)
  const model = inputs.model
  // const modelMode = inputs.model?.mode
  // const isChatMode = modelMode === 'chat'

  return (
    <BasePanel>
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

        <Field
          title={t(`${i18nPrefix}.context`)}
          operations={
            <Switch
              defaultValue={inputs.context.enabled}
              onChange={toggleContextEnabled}
              size='md'
            />
          }
        >
          {inputs.context.enabled
            ? (
              <div>Context</div>
            )
            : null}
        </Field>
        <Field
          title={t(`${i18nPrefix}.prompt`)}
        >
          Prompt
        </Field>
        <Split />
        <Field
          title={t(`${i18nPrefix}.vision`)}
          inline
        >
          Vision
        </Field>
        {/* This version not support function */}
        {/* <Field
            title={t(`${i18nPrefix}.fu`)}
            inline
          >
            Functions
          </Field> */}
      </div>
    </BasePanel>
  )
}

export default Panel
