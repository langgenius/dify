import type { FC } from 'react'
import { memo } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
const Node: FC<NodeProps<KnowledgeBaseNodeType>> = () => {
  return (
    <div className='mb-1 px-3 py-1'>
      KnowledgeBase
    </div>
  )
}

export default memo(Node)
