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
export const draftResponse = {
  hash: 'server-hash',
  updated_at: 1234,
  graph: { nodes, edges: [], viewport },
  environment_variables: [],
  conversation_variables: [],
}
