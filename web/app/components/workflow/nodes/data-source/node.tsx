import type { FC } from 'react'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
const Node: FC<NodeProps<DataSourceNodeType>> = () => {
  return (
    <div>
    </div>
  )
}

export default memo(Node)
