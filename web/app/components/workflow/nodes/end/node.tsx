import type { FC } from 'react'
import React from 'react'
import type { EndNodeType } from './types'
import type { NodeProps, Variable } from '@/app/components/workflow/types'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

const Node: FC<NodeProps<EndNodeType>> = ({
  id,
  data,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(id)
  const { getCurrentVariableType } = useWorkflowVariables()
  const isChatMode = useIsChatMode()

  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const getNode = (id: string) => {
    return availableNodes.find(node => node.id === id) || startNode
  }

  const { outputs } = data
  const filteredOutputs = (outputs as Variable[]).filter(({ value_selector }) => value_selector.length > 0)

  if (!filteredOutputs.length)
    return null

  return (
    <div className='mb-1 space-y-0.5 px-3 py-1'>
      {filteredOutputs.map(({ value_selector }, index) => {
        const node = getNode(value_selector[0])
        const varType = getCurrentVariableType({
          valueSelector: value_selector,
          availableNodes,
          isChatMode,
        })

        return (
          <VariableLabelInNode
            key={index}
            variables={value_selector}
            nodeType={node?.data.type}
            nodeTitle={node?.data.title}
            variableType={varType}
          />
        )
      })}

    </div>
  )
}

export default React.memo(Node)
