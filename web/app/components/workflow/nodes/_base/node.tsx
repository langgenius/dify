import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
  useCallback,
  useMemo,
} from 'react'
import type { NodeProps } from 'reactflow'
import { getOutgoers } from 'reactflow'
import { useWorkflowContext } from '../../context'
import { BlockEnum } from '../../types'
import NodeControl from '../../node-control'
import BlockIcon from '../../block-icon'
import AddNode from './components/add-node/index'

type BaseNodeProps = {
  children: ReactElement
} & Pick<NodeProps, 'id' | 'data'>

const BaseNode: FC<BaseNodeProps> = ({
  id: nodeId,
  data,
  children,
}) => {
  const {
    nodes,
    edges,
    selectedNodeId,
    handleSelectedNodeIdChange,
    handleAddNextNode,
  } = useWorkflowContext()
  const currentNode = useMemo(() => {
    return nodes.find(node => node.id === nodeId)
  }, [nodeId, nodes])
  const outgoers = useMemo(() => {
    return getOutgoers(currentNode!, nodes, edges)
  }, [currentNode, nodes, edges])
  const handleSelectBlock = useCallback((type: BlockEnum) => {
    handleAddNextNode(currentNode!, type)
  }, [currentNode, handleAddNextNode])
  const branches = useMemo(() => {
    if (data.type === BlockEnum.IfElse) {
      return [
        {
          id: '1',
          name: 'Is True',
        },
        {
          id: '2',
          name: 'Is False',
        },
      ]
    }
  }, [data])

  return (
    <div
      className={`
        group relative pb-2 w-[240px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${selectedNodeId === nodeId ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
      onClick={() => handleSelectedNodeIdChange(nodeId || '')}
    >
      <NodeControl />
      <div className='flex items-center px-3 pt-3 pb-2'>
        <BlockIcon
          className='mr-2'
          type={currentNode!.data.type}
          size='md'
        />
        <div className='text-[13px] font-semibold text-gray-700'>
          {data.title}
        </div>
      </div>
      {cloneElement(children, { id: nodeId, data })}
      <div className='px-3 pt-1 pb-1 text-xs text-gray-500'>
        Define the initial parameters for launching a workflow
      </div>
      <AddNode
        outgoers={outgoers}
        branches={branches}
        onAddNextNode={handleSelectBlock}
      />
    </div>
  )
}

export default memo(BaseNode)
