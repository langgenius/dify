'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
const nodes = [
  BlockEnum.Start, BlockEnum.DirectAnswer, BlockEnum.LLM, BlockEnum.KnowledgeRetrieval, BlockEnum.QuestionClassifier,
  BlockEnum.IfElse, BlockEnum.Code, BlockEnum.TemplateTransform, BlockEnum.HttpRequest,
  BlockEnum.Tool, BlockEnum.End,
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
        /*
        * TODO: for debug.
        * 2 directAnswer 3: llm 5: questionClassifier
        * 6 if else 7 Code, 8 TemplateTransform 9 http
        */
        selectedNodeId='6'
      />
    </div>
  )
}
export default memo(Page)
