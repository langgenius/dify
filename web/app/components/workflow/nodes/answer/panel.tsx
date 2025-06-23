import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { AnswerNodeType } from './types'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
const i18nPrefix = 'workflow.nodes.answer'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'

const Panel: FC<NodePanelProps<AnswerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleAnswerChange,
    filterVar,
    handleVarListChange,
    handleAddVariable,
  } = useConfig(id, data)

  const outputs = inputs?.outputs || []

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    hideChatVar: false,
    hideEnv: false,
    filterVar,
  })

  return (
    <div className='mt-2'>
      <div className='mb-2 mt-2 space-y-4 px-4'>
        <Editor
          readOnly={readOnly}
          justVar
          title={t(`${i18nPrefix}.answer`)!}
          value={inputs.answer}
          onChange={handleAnswerChange}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
          isSupportFileVar
        />
      </div>
      <div className='space-y-4 px-4 pb-4'>
        <Field
          title={t(`${i18nPrefix}.outputVars`)}
          operations={
            !readOnly ? <AddButton onClick={handleAddVariable} /> : undefined
          }
        >
          <VarList
            nodeId={id}
            readonly={readOnly}
            list={outputs}
            onChange={handleVarListChange}
          />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
