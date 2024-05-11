import type { FC } from 'react'
import React from 'react'
import type { ParameterExtractorNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<ParameterExtractorNodeType>> = ({
  id,
  data,
}) => {
  return (
    <div className='mt-2'>
      parameter extractor
    </div>
  )
}

export default React.memo(Panel)
