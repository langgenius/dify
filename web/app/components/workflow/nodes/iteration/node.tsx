import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import type { IterationNodeType } from './types'
import AddBlock from './add-block'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<IterationNodeType>> = ({
  id,
}) => {
  return (
    <div className={cn(
      'min-w-[264px] min-h-[128px] w-full h-full rounded-2xl',
    )}>
      <AddBlock iterationNodeId={id} />
    </div>
  )
}

export default React.memo(Node)
