import type { GeneratedGraph } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import { diffGraphs } from '../graph-diff'

type GraphNode = GeneratedGraph['nodes'][number]

const node = (id: string, data: Record<string, unknown> = {}): GraphNode => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { type: BlockEnum.Code, title: id, desc: '', ...data },
})
const graph = (nodes: GraphNode[]): GeneratedGraph => ({
  nodes,
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
})

describe('diffGraphs', () => {
  it('handles a mix of added, removed and changed at once', () => {
    const base = graph([node('keep', { v: 1 }), node('drop'), node('edit', { v: 1 })])
    const next = graph([node('keep', { v: 1 }), node('edit', { v: 2 }), node('new')])
    const result = diffGraphs(base, next)
    expect(result.added).toEqual(['new'])
    expect(result.removed).toEqual(['drop'])
    expect(result.changed).toEqual(['edit'])
  })
})
