import type { FC } from 'react'
import {
  memo,
  useEffect,
} from 'react'
import {
  Background,
  useNodesInitialized,
  useViewport,
} from 'reactflow'
import cn from 'classnames'
import { useNodesInteractions } from '../../hooks'
import type { IterationNodeType } from './types'
import AddBlock from './add-block'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { zoom } = useViewport()
  const nodesInitialized = useNodesInitialized()
  const { handleNodeRerender } = useNodesInteractions()

  useEffect(() => {
    if (nodesInitialized)
      handleNodeRerender(id)
  }, [nodesInitialized, id, handleNodeRerender])

  return (
    <div className={cn(
      'relative min-w-[264px] min-h-[128px] w-full h-full rounded-2xl bg-[#F0F2F7]/90',
    )}>
      <Background
        id={`iteration-background-${id}`}
        className='rounded-2xl !z-0'
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color='#E4E5E7'
      />
      <AddBlock
        iterationNodeId={id}
        iterationNodeData={data}
      />
    </div>
  )
}

export default memo(Node)
