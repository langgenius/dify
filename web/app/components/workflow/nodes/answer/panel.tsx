import type { FC } from 'react'
import type { AnswerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useConfig from './use-config'

const i18nPrefix = 'nodes.answer'

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
    <div className="mb-2 mt-2 space-y-4 px-4">
      <Editor
        readOnly={readOnly}
        justVar
        title={t(`${i18nPrefix}.answer`, { ns: 'workflow' })!}
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
