import type { FC } from 'react'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
const Node: FC<NodeProps<DataSourceNodeType>> = () => {
  return (
    <div className='mb-1 px-3 py-1'>
      DataSource
    </div>
  )
}

export default memo(Node)
