import type { FC } from 'react'
import { memo } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import IndexMethod from './components/index-method'
import type { NodePanelProps } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = () => {
  return (
    <div>
      <div className='py-2'>
        <div className='px-4 py-2'>
          <IndexMethod />
        </div>
      </div>
    </div>
  )
}

export default memo(Panel)
