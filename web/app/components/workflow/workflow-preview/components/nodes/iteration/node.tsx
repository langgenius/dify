import type { FC } from 'react'
import {
  memo,
} from 'react'
import {
  Background,
  useViewport,
} from 'reactflow'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import cn from '@/utils/classnames'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<IterationNodeType>> = ({
  id,
}) => {
  const { zoom } = useViewport()

  return (
    <div className={cn(
      'relative h-full min-h-[90px] w-full min-w-[240px] rounded-2xl bg-workflow-canvas-workflow-bg',
    )}>
      <Background
        id={`iteration-background-${id}`}
        className='!z-0 rounded-2xl'
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color='var(--color-workflow-canvas-workflow-dot-color)'
      />
    </div>
  )
}

export default memo(Node)
