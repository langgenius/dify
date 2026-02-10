import type { FC } from 'react'
import type { FileUploadNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'

const Node: FC<NodeProps<FileUploadNodeType>> = () => {
  return (
    <div></div>
  )
}

export default React.memo(Node)
