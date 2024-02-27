import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import ConditionList from './components/condition-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
const i18nPrefix = 'workflow.nodes.ifElse'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleConditionsChange,
    handleAddCondition,
  } = useConfig(mockData)
  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.conditions`)}
        >
          <ConditionList
            readonly={readOnly}
            list={inputs.conditions}
            onChange={handleConditionsChange}
          />
        </Field>
      </div>
    </div>
  )
}

export default Panel
