import type { FC } from 'react'
import type { CodeNodeType } from '../../nodes/code/types'
import type { NodeProps } from '../../types'
import * as React from 'react'

const Node: FC<NodeProps<CodeNodeType>> = () => {
  return (
    // No summary content
    <div></div>
  )
}

export default React.memo(Node)
