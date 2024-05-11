import type { FC } from 'react'
import React from 'react'
import type { ParameterExtractorNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<ParameterExtractorNodeType>> = () => {
  return (
    <div>parameter extractor</div>
  )
}

export default React.memo(Node)
