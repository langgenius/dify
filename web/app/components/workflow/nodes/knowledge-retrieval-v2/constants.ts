import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

export const KNOWLEDGE_RETRIEVAL_V2_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'result',
    type: VarType.arrayObject,
    children: [
      { variable: 'content', type: VarType.string },
      { variable: 'title', type: VarType.string },
      {
        variable: 'metadata',
        type: VarType.object,
        children: [
          {
            variable: 'citation',
            type: VarType.object,
            children: [
              { variable: 'artifact_hash', type: VarType.string },
              { variable: 'document_id', type: VarType.string },
              { variable: 'document_version', type: VarType.integer },
              { variable: 'section_path', type: VarType.arrayString },
              { variable: 'page_number', type: VarType.integer },
              { variable: 'start_offset', type: VarType.integer },
              { variable: 'end_offset', type: VarType.integer },
            ],
          },
          { variable: 'node_id', type: VarType.string },
          { variable: 'projection_ids', type: VarType.arrayString },
          { variable: 'score', type: VarType.number },
          { variable: 'sources', type: VarType.arrayString },
          { variable: 'space_id', type: VarType.string },
        ],
      },
    ],
  },
  {
    variable: 'metrics',
    type: VarType.object,
    children: [
      { variable: 'mode', type: VarType.string },
      { variable: 'total_ms', type: VarType.number },
      { variable: 'degradation_flags', type: VarType.arrayString },
    ],
  },
]

export const KNOWLEDGE_RETRIEVAL_V2_NODE_KINDS = [
  'chunk',
  'section',
  'table',
  'image',
  'summary',
] as const

export const KNOWLEDGE_RETRIEVAL_V2_TOP_N_MAX = 100
