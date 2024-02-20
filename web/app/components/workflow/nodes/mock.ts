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
    nodeId: 'aaa',
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
    nodeId: 'bbb',
    title: 'LLM',
    vars: [
      {
        variable: 'usage',
        type: 'object',
        children: [
          {
            variable: 'token',
            type: 'object',
            children: [
              {
                variable: 'num',
                type: 'number',
              },
              {
                variable: 'price',
                type: 'number',
              },
            ],
          },
        ],
      },
      {
        variable: 'other',
        type: 'object',
        children: [
          {
            variable: 'a',
            type: 'object',
            children: [
              {
                variable: 'b',
                type: 'object',
                children: [
                  {
                    variable: 'c',
                    type: 'string',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]
