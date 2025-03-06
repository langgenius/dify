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
import { LoopStartNodeDumb } from '../loop-start'
import { useNodeLoopInteractions } from './use-interactions'
import type { LoopNodeType } from './types'
import AddBlock from './add-block'
import cn from '@/utils/classnames'

import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<LoopNodeType>> = ({
  id,
  data,
}) => {
  const { zoom } = useViewport()
  const nodesInitialized = useNodesInitialized()
  const { handleNodeLoopRerender } = useNodeLoopInteractions()

  useEffect(() => {
    if (nodesInitialized)
      handleNodeLoopRerender(id)
  }, [nodesInitialized, id, handleNodeLoopRerender])

  return (
    <div className={cn(
      'relative min-w-[240px] min-h-[90px] w-full h-full rounded-2xl bg-[#F0F2F7]/90',
    )}>
      <Background
        id={`loop-background-${id}`}
        className='rounded-2xl !z-0'
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color='#E4E5E7'
      />
      {
        data._isCandidate && (
          <LoopStartNodeDumb />
        )
      }
      {
        data._children!.length === 1 && (
          <AddBlock
            loopNodeId={id}
            loopNodeData={data}
          />
        )
      }

    </div>
  )
}

export default memo(Node)
