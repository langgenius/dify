import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import BasePanel from '../_base/panel'
import useInput from './use-input'
import { mockLLMNodeData } from './mock'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC = () => {
  const { t } = useTranslation()
  const { inputs, handleModelChanged } = useInput(mockLLMNodeData)
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const handleAddVariable = () => {
    console.log('add variable')
  }
  return (
    <BasePanel
      inputsElement={
        <div className='mt-2 px-4 space-y-4'>
          <Field
            title={t(`${i18nPrefix}.model`)}
          >
            <ModelSelector
              defaultModel={(inputs.model?.provider && inputs.model?.name)
                ? {
                  provider: inputs.model.provider,
                  model: inputs.model.name,
                }
                : undefined}
              modelList={textGenerationModelList}
              onSelect={handleModelChanged}
            />
          </Field>

          <Field
            title={t(`${i18nPrefix}.variables`)}
            operations={
              <AddButton onClick={handleAddVariable} />
            }
          >
            Var Selector
          </Field>

          <Field
            title={t(`${i18nPrefix}.context`)}
          >
            Context
          </Field>
          <Field
            title={t(`${i18nPrefix}.context`)}
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
      }
      outputsElement={<div>start panel outputs</div>}
    />
  )
}

export default Panel
