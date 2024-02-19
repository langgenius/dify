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
import BlockSelector from '../../block-selector'
import { getBlockByType } from '../../block-selector/utils'
import BlockIcon from '../../block-icon'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

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
  } = useWorkflowContext()
  const currentNode = useMemo(() => {
    return nodes.find(node => node.id === nodeId)
  }, [nodeId, nodes])
  const outgoers = useMemo(() => {
    return getOutgoers(currentNode!, nodes, edges)
  }, [currentNode, nodes, edges])
  const renderBlockSelectorChildren = useCallback(({ open, ref, ...restProps }: any) => {
    return (
      <div onClick={e => e.stopPropagation()}>
        <div
          {...restProps}
          ref={ref}
          className={`
            hidden absolute -bottom-2 left-1/2 -translate-x-1/2 items-center justify-center 
            w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10 group-hover:flex
            ${open && '!flex'}
          `}
        >
          <Plus className='w-2.5 h-2.5 text-white' />
        </div>
      </div>
    )
  }, [])

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
        <div className='text-[13px] font-semibold text-gray-700'>
          {getBlockByType(currentNode!.data.type)?.title}
        </div>
      </div>
      {cloneElement(children, { id: nodeId, data })}
      <div className='px-3 pt-1 pb-1 text-xs text-gray-500'>
        Define the initial parameters for launching a workflow
      </div>
      {
        !outgoers.length && (
          <BlockSelector
            placement='right'
            offset={6}
          >
            {renderBlockSelectorChildren}
          </BlockSelector>
        )
      }
    </div>
  )
}

export default memo(BaseNode)
