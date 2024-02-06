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
  {
    id: '2',
    type: 'custom',
    position: { x: 330, y: 212 },
    data: { type: 'start' },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 150, y: 394 },
    data: { type: 'start' },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 510, y: 394 },
    data: { type: 'start' },
  },
]

const initialEdges = [
  {
    id: '1',
    source: '1',
    target: '2',
    type: 'custom',
  },
  {
    id: '2',
    source: '2',
    target: '3',
    type: 'custom',
  },
  {
    id: '3',
    source: '2',
    target: '4',
    type: 'custom',
  },
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
