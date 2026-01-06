import type { FC } from 'react'
import type { CommandNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'

const Node: FC<NodeProps<CommandNodeType>> = () => {
  return (
    // No summary content - same as Code node
    <div></div>
  )
}

export default React.memo(Node)
