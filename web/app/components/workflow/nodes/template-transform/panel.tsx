import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import AddButton from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'

const i18nPrefix = 'workflow.nodes.templateTransform'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
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
      <CodeEditor
        title={
          <div>{t(`${i18nPrefix}.code`)}</div>
        }
        value={inputs.template}
        onChange={handleCodeChange}
      />
      <Split />
      <OutputVars>
        <>
          <VarItem
            name='output'
            type='string'
            description={t(`${i18nPrefix}.outputVars.output`)}
          />
        </>
      </OutputVars>
    </div>
  )
}

export default Panel
