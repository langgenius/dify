'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
const nodes = [
  BlockEnum.Tool/* 10 */, BlockEnum.VariableAssigner/* 11 */, BlockEnum.Start/* 1 */, BlockEnum.DirectAnswer/* 2 */, BlockEnum.LLM/* 3 */, BlockEnum.KnowledgeRetrieval/* 4 */, BlockEnum.QuestionClassifier/* 5 */,
  BlockEnum.IfElse/* 6 */, BlockEnum.Code/* 7 */, BlockEnum.TemplateTransform/* 8 */, BlockEnum.HttpRequest/* 9 */,
  BlockEnum.End/* 12 */,
].map((item, i) => ({
  id: `${i + 1}`,
  type: 'custom',
  position: { x: 330, y: 30 + i * 300 },
  data: { type: item, name: item },
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
        selectedNodeId='1'
      />
    </div>
  )
}
export default memo(Page)
