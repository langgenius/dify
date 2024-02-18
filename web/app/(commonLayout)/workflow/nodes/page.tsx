'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'
const nodes = [
  'start', 'directAnswer', 'llm', 'knowledgeRetrieval', 'questionClassifier',
  'questionClassifier', 'ifElse', 'code', 'templateTransform', 'http',
  'tool',
].map((item, i) => ({
  id: `${i + 1}`,
  type: 'custom',
  position: { x: 330, y: 30 + i * 200 },
  data: { type: item },
}))
const initialNodes = nodes

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
        selectedNodeId='3'// TODO: for debug. 3: llm.
      />
    </div>
  )
}
export default memo(Page)
