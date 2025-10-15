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
import type { LoopNodeType } from '@/app/components/workflow/nodes/loop/types'
import cn from '@/utils/classnames'
import type { NodeProps } from '@/app/components/workflow/types'
import { useNodeLoopInteractions } from './hooks'

const Node: FC<NodeProps<LoopNodeType>> = ({
  id,
  data: _data,
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
      // style={{
      //   width: data.width || 'auto',
      // }}
    >
      <Background
        id={`loop-background-${id}`}
        className='!z-0 rounded-2xl'
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color='var(--color-workflow-canvas-workflow-dot-color)'
      />
    </div>
  )
}

export default memo(Node)
