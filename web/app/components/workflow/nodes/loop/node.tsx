import type { FC } from 'react'
import type { LoopNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import {
  memo,
  useEffect,
} from 'react'
import {
  Background,
  useNodesInitialized,
  useViewport,
} from 'reactflow'
import { cn } from '@/utils/classnames'
import { LoopStartNodeDumb } from '../loop-start'
import AddBlock from './add-block'

import { useNodeLoopInteractions } from './use-interactions'

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
      'relative h-full min-h-[90px] w-full min-w-[240px] rounded-2xl bg-workflow-canvas-workflow-bg',
    )}
    >
      <Background
        id={`loop-background-${id}`}
        className="!z-0 rounded-2xl"
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color="var(--color-workflow-canvas-workflow-dot-color)"
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
