'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'

const initialNodes = [
  {
    id: '1',
    type: 'custom',
    position: { x: 130, y: 130 },
    data: { type: 'start' },
  },
  {
    id: '2',
    type: 'custom',
    position: { x: 434, y: 130 },
    data: { type: 'code' },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 738, y: 130 },
    data: { type: 'llm' },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 738, y: 330 },
    data: { type: 'llm' },
  },
]

const initialEdges = [
  {
    id: '0',
    source: '1',
    target: '2',
  },
  {
    id: '1',
    source: '2',
    target: '3',
  },
  {
    id: '2',
    source: '2',
    target: '4',
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
