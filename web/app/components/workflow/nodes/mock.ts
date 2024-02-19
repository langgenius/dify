import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

export const mockNodesData: Record<string, any> = {
  aaa: {
    title: 'Start',
    type: BlockEnum.Start,
  },
  bbb: {
    title: 'Knowledge',
    type: BlockEnum.KnowledgeRetrieval,
  },
  ccc: {
    title: 'Code',
    type: BlockEnum.Code,
  },
}

export const mockNodeOutputVars: NodeOutPutVar[] = [
  {
    title: 'Start',
    vars: [
      {
        variable: 'query',
        type: 'string',
      },
      {
        variable: 'age',
        type: 'number',
      },
    ],
  },
  {
    title: 'LLM',
    vars: [
      {
        variable: 'usage',
        type: 'object',
        struct: ['token', 'value'],
      },
    ],
  },
]
