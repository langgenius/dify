import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
const i18nPrefix = 'workflow.nodes.directAnswer'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleAnswerChange,
  } = useConfig(mockData)

  return (
    <div className='mt-2 px-4 space-y-4'>
      <Field
        title={t(`${i18nPrefix}.inputVars`)}
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
      <Split />
      <Editor
        title={t(`${i18nPrefix}.answer`)}
        value={inputs.answer}
        onChange={handleAnswerChange}
        variables={inputs.variables.map(item => item.variable)}
      />
    </div>
  )
}

export default Panel
