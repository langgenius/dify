import type { FC } from 'react'
import React from 'react'
import type { IterationNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<IterationNodeType>> = () => {
  return (
    <div>iteration</div>
  )
}

export default React.memo(Node)
