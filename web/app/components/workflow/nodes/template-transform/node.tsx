import type { FC } from 'react'
import type { TemplateTransformNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'

const Node: FC<NodeProps<TemplateTransformNodeType>> = () => {
  return (
    // No summary content
    <div></div>
  )
}

export default React.memo(Node)
