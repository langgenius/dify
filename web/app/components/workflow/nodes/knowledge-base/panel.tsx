import type { FC } from 'react'
import { memo } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = () => {
  return (
    <div className='mb-2 mt-2 space-y-4 px-4'>
      Knowledge Base
    </div>
  )
}

export default memo(Panel)
