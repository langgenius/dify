import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import BasePanel from '../_base/panel'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC = () => {
  const { t } = useTranslation()
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
            Model Selector
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
