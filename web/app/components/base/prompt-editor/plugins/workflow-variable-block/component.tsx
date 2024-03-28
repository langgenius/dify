import type { FC } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND } from './index'
import type { Node } from '@/app/components/workflow/types'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  getWorkflowNode: (nodeId: string) => Node
}

const WorkflowVariableBlockComponent: FC<WorkflowVariableBlockComponentProps> = ({
  nodeKey,
  variables,
  getWorkflowNode,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND)
  const node = getWorkflowNode(variables[0])
  const variablesLength = variables.length
  const lastVariable = variables[variablesLength - 1]

  return (
    <div
      className={`
        inline-flex items-center pl-1 pr-0.5 h-6 bg-white border-[0.5px] border-black/5 rounded-[5px]
        hover:border hover:border-primary-300 hover:bg-primary-25
        ${isSelected && '!border !border-primary-500 !bg-primary-50'}
      `}
      ref={ref}
    >
      <div>{node.data.title}</div>
      /
      <div>{lastVariable}</div>
    </div>
  )
}

export default WorkflowVariableBlockComponent
