import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { AnswerNodeType } from './types'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.answer'

const Panel: FC<NodePanelProps<AnswerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleAnswerChange,
    filterVar,
  } = useConfig(id, data)

  return (
    <div className='mt-2 px-4 space-y-4'>
      <Field
        title={t(`${i18nPrefix}.outputVars`)}
        operations={
          !readOnly ? <AddButton onClick={handleAddVariable} /> : undefined
        }
      >
        <VarList
          nodeId={id}
          readonly={readOnly}
          list={inputs.variables}
          onChange={handleVarListChange}
          filterVar={filterVar}
        />
      </Field>
      <Split />
      <Editor
        readOnly={readOnly}
        justVar
        title={t(`${i18nPrefix}.answer`)!}
        value={inputs.answer}
        onChange={handleAnswerChange}
        variables={inputs.variables.map(item => item.variable)}
      />
    </div>
  )
}

export default React.memo(Panel)
