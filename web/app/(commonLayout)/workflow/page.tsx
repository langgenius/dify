'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'

const initialNodes = [
  {
    id: '1',
    type: 'custom',
    position: { x: 330, y: 30 },
    data: { type: 'start' },
  },
]

const initialEdges = [

]

const Page: FC = () => {
  return (
    <div className='min-w-[720px] w-full h-full overflow-x-auto'>
      <Workflow
        nodes={initialNodes}
        edges={initialEdges}
      />
    </div>
  )
}
export default memo(Page)
