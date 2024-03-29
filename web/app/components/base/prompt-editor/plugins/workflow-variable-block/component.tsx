import type { FC } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND } from './index'
import type { Node } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { Line3 } from '@/app/components/base/icons/src/public/common'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  getWorkflowNode: (nodeId: string) => Node | undefined
}

const WorkflowVariableBlockComponent: FC<WorkflowVariableBlockComponentProps> = ({
  nodeKey,
  variables,
  getWorkflowNode,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND)
  const node = getWorkflowNode(variables[0])
  const outputVarNode = node?.data
  const variablesLength = variables.length
  const lastVariable = variables[variablesLength - 1]

  return (
    <div
      className={`
        mr-[2px] relative group/wrap flex items-center h-[20px] pl-0.5 pr-[3px] rounded-[5px] border
        ${isSelected ? ' border-[#84ADFF] bg-[#F5F8FF]' : ' border-black/5 bg-white'}
      `}
      ref={ref}
    >
      <div className='flex items-center'>
        <div className='p-[1px]'>
          <VarBlockIcon
            className='!text-gray-500'
            type={outputVarNode?.type || BlockEnum.Start}
          />
        </div>
        <div className='shrink-0 mx-0.5 text-xs font-medium text-gray-500 truncate' title={outputVarNode?.title} style={{
        }}>{outputVarNode?.title}</div>
        <Line3 className='mr-0.5 text-gray-300'></Line3>
      </div>
      <div className='flex items-center text-primary-600'>
        <Variable02 className='w-3.5 h-3.5' />
        <div className='shrink-0 ml-0.5 text-xs font-medium truncate' title={lastVariable}>{lastVariable}</div>
      </div>
    </div>
  )
}

export default WorkflowVariableBlockComponent
