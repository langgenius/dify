import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import BasePanel from '../_base/panel'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
const i18nPrefix = 'workflow.nodes.llm'

const Panel: FC = () => {
  const { t } = useTranslation()
  const handleAddVariable = () => {
    console.log('add variable')
  }
  return (
    <BasePanel
      inputsElement={<div>
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
      </div>}
      outputsElement={<div>start panel outputs</div>}
    />
  )
}

export default Panel
