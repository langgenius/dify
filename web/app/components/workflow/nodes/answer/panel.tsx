import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { AnswerNodeType } from './types'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
const i18nPrefix = 'workflow.nodes.answer'

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
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    hideChatVar: false,
    hideEnv: false,
    filterVar,
  })

  return (
    <div className='mt-2 mb-2 px-4 space-y-4'>
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
  )
}

export default React.memo(Panel)
