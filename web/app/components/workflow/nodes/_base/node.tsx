import type {
  FC,
  ReactNode,
} from 'react'
import { memo, useMemo } from 'react'
import {
  getOutgoers,
  useNodeId,
} from 'reactflow'
import { useWorkflowContext } from '../../context'
import BlockSelector from '../../block-selector'
import BlockIcon from '../../block-icon'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

type BaseNodeProps = {
  children: ReactNode
}

const BaseNode: FC<BaseNodeProps> = ({
  children,
}) => {
  const nodeId = useNodeId()
  const {
    nodes,
    edges,
    selectedNodeId,
    handleSelectedNodeIdChange,
  } = useWorkflowContext()
  const currentNode = useMemo(() => {
    return nodes.find(node => node.id === nodeId)
  }, [nodeId, nodes])
  const outgoers = useMemo(() => {
    return getOutgoers(currentNode!, nodes, edges)
  }, [currentNode, nodes, edges])

  return (
    <div
      className={`
        group relative pb-2 w-[296px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${selectedNodeId === nodeId ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
      onClick={() => handleSelectedNodeIdChange(nodeId || '')}
    >
      <div className='flex items-center px-3 pt-3 pb-2'>
        <BlockIcon
          className='mr-2'
          type={currentNode!.data.type}
          size='md'
        />
        <div className='text-[13px] font-semibold text-gray-700'>START</div>
      </div>
      {children}
      <div className='px-3 pt-1 pb-1 text-xs text-gray-500'>
        Define the initial parameters for launching a workflow
      </div>
      <BlockSelector>
        <div
          className={`
            hidden absolute -bottom-2 left-1/2 -translate-x-1/2 items-center justify-center 
            w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10
            ${!outgoers.length && 'group-hover:flex'}
          `}
        >
          <Plus className='w-2.5 h-2.5 text-white' />
        </div>
      </BlockSelector>
    </div>
  )
}

export default memo(BaseNode)
