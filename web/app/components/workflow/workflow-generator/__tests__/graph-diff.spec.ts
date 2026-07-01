import type { GeneratedGraph } from '../types'
import { diffGraphs } from '../graph-diff'

type GraphNode = GeneratedGraph['nodes'][number]

// diffGraphs only reads `id` and `data`, so a minimal node shape is enough.
const node = (id: string, data: Record<string, unknown> = {}): GraphNode =>
  ({ id, data } as unknown as GraphNode)
const graph = (nodes: GraphNode[]): GeneratedGraph =>
  ({ nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } })

describe('diffGraphs', () => {
  it('reports nodes added in the new graph', () => {
    const result = diffGraphs(graph([node('a')]), graph([node('a'), node('b')]))
    expect(result.added).toEqual(['b'])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
  })

  it('reports nodes dropped from the base graph', () => {
    const result = diffGraphs(graph([node('a'), node('b')]), graph([node('a')]))
    expect(result.removed).toEqual(['b'])
    expect(result.added).toEqual([])
  })

  it('reports nodes whose data changed', () => {
    const result = diffGraphs(graph([node('a', { temperature: 0.2 })]), graph([node('a', { temperature: 0.9 })]))
    expect(result.changed).toEqual(['a'])
  })

  it('treats identical data as unchanged', () => {
    const result = diffGraphs(graph([node('a', { temperature: 0.2 })]), graph([node('a', { temperature: 0.2 })]))
    expect(result.changed).toEqual([])
  })

  it('handles a mix of added, removed and changed at once', () => {
    const base = graph([node('keep', { v: 1 }), node('drop'), node('edit', { v: 1 })])
    const next = graph([node('keep', { v: 1 }), node('edit', { v: 2 }), node('new')])
    const result = diffGraphs(base, next)
    expect(result.added).toEqual(['new'])
    expect(result.removed).toEqual(['drop'])
    expect(result.changed).toEqual(['edit'])
  })
})
