'use client'

import type { FC } from 'react'
import { memo } from 'react'
import Workflow from '@/app/components/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { mockData as StartNodeMock } from '@/app/components/workflow/nodes/start/mock'
import { mockData as DirectAnswerNodeMock } from '@/app/components/workflow/nodes/direct-answer/mock'
import { mockData as LLMNodeMock } from '@/app/components/workflow/nodes/llm/mock'
import { mockData as KnowledgeRetrievalNodeMock } from '@/app/components/workflow/nodes/knowledge-retrieval/mock'
import { mockData as QuestionClassifierNodeMock } from '@/app/components/workflow/nodes/question-classifier/mock'
import { mockData as IfElseNodeMock } from '@/app/components/workflow/nodes/if-else/mock'
import { mockData as CodeNodeMock } from '@/app/components/workflow/nodes/code/mock'
import { mockData as TemplateTransformNodeMock } from '@/app/components/workflow/nodes/template-transform/mock'
import { mockData as HttpRequestNodeMock } from '@/app/components/workflow/nodes/http/mock'
import { mockData as ToolNodeMock } from '@/app/components/workflow/nodes/tool/mock'
import { mockData as VariableAssignerNodeMock } from '@/app/components/workflow/nodes/variable-assigner/mock'
import { mockData as EndNodeMock } from '@/app/components/workflow/nodes/end/mock'

const allMockData = {
  [BlockEnum.Start]: StartNodeMock,
  [BlockEnum.DirectAnswer]: DirectAnswerNodeMock,
  [BlockEnum.LLM]: LLMNodeMock,
  [BlockEnum.KnowledgeRetrieval]: KnowledgeRetrievalNodeMock,
  [BlockEnum.QuestionClassifier]: QuestionClassifierNodeMock,
  [BlockEnum.IfElse]: IfElseNodeMock,
  [BlockEnum.Code]: CodeNodeMock,
  [BlockEnum.TemplateTransform]: TemplateTransformNodeMock,
  [BlockEnum.HttpRequest]: HttpRequestNodeMock,
  [BlockEnum.Tool]: ToolNodeMock,
  [BlockEnum.VariableAssigner]: VariableAssignerNodeMock,
  [BlockEnum.End]: EndNodeMock,
}
const nodes = [
  BlockEnum.Code/* 7 */, BlockEnum.KnowledgeRetrieval/* 4 */, BlockEnum.Start/* 1 */, BlockEnum.DirectAnswer/* 2 */, BlockEnum.LLM/* 3 */, BlockEnum.QuestionClassifier/* 5 */,
  BlockEnum.IfElse/* 6 */, BlockEnum.TemplateTransform/* 8 */, BlockEnum.HttpRequest/* 9 */, BlockEnum.Tool/* 10 */,
  BlockEnum.VariableAssigner/* 11 */, BlockEnum.End/* 12 */,
].map((item, i) => {
  const payload = allMockData[item]
  return ({
    id: `${i + 1}`,
    type: 'custom',
    position: { x: 330, y: 30 + i * 300 },
    data: {
      selected: i === 0, // for test: always select the first node
      name: item,
      ...payload,
    },
  })
})

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
      />
    </div>
  )
}
export default memo(Page)
