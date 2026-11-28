import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

// Shared graph data for canvas-navigation.browser.spec.tsx and its canvas fixture.

export const nodes: Node[] = [
  {
    id: 'start',
    type: 'custom',
    position: { x: 200, y: 150 },
    data: { type: BlockEnum.Start, title: 'Start', desc: '' },
  },
]
export const viewport = { x: 0, y: 0, zoom: 1 }
export const appId = '00000000-0000-4000-8000-000000000001'
export const draftResponse = {
  id: 'draft-workflow',
  version: 'draft',
  marked_name: '',
  marked_comment: '',
  tool_published: false,
  created_at: 1234,
  hash: 'server-hash',
  updated_at: 1234,
  graph: { nodes, edges: [], viewport },
  features: {},
  environment_variables: [],
  conversation_variables: [],
  rag_pipeline_variables: [],
}
