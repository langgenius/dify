import type { FC } from 'react'
import React from 'react'
import type { IterationNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  return (
    <div className='mt-2'>
      iteration
    </div>
  )
}

export default React.memo(Panel)
