import type { FC } from 'react'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = () => {
  return (
    <div className='mb-2 mt-2 space-y-4 px-4'>
      datasource
    </div>
  )
}

export default memo(Panel)
