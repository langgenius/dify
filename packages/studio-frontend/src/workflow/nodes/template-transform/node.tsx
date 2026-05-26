import type { FC } from 'react'
import type { TemplateTransformNodeType } from '../../nodes/template-transform/types'
import type { NodeProps } from '../../types'
import * as React from 'react'

const Node: FC<NodeProps<TemplateTransformNodeType>> = () => {
  return (
    // No summary content
    <div></div>
  )
}

export default React.memo(Node)
