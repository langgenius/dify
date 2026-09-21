import type { Node } from '../../../types'
import { BlockEnum } from '../../../types'
import { applyServerGraphChange } from '../server-graph-change'

const node = (id: string): Node<{ model: { name: string; temperature: number } }> => ({
  id,
  position: { x: 0, y: 0 },
  data: { type: BlockEnum.LLM, title: id, desc: '', model: { name: 'old', temperature: 0.1 } },
})

describe('server graph changes', () => {
  it('applies only the Builder changes while preserving another editor’s nodes, position and configuration', () => {
    const before = { nodes: [node('llm')], edges: [] }
    const current = { nodes: [node('llm'), node('collaborator')], edges: [] }
    current.nodes[0]!.position = { x: 100, y: 200 }
    current.nodes[0]!.data.model = { name: 'old', temperature: 0.9 }
    const after = { nodes: [node('llm'), node('builder')], edges: [] }
    after.nodes[0]!.data.model = { name: 'new', temperature: 0.1 }

    const result = applyServerGraphChange(current, before, after)

    expect(result.nodes.map((item) => item.id)).toEqual(['llm', 'collaborator', 'builder'])
    expect(result.nodes[0]).toMatchObject({
      position: { x: 100, y: 200 },
      data: { model: { name: 'new', temperature: 0.9 } },
    })
    expect(current.nodes[0]!.data.model).toEqual({ name: 'old', temperature: 0.9 })
  })

  it('keeps concurrent deletions and removes edges whose endpoint was deleted', () => {
    const before = { nodes: [node('a'), node('b')], edges: [] }
    const after = {
      nodes: [node('a'), { ...node('b'), position: { x: 1, y: 1 } }],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
    }
    expect(applyServerGraphChange({ nodes: [node('a')], edges: [] }, before, after)).toEqual({
      nodes: [node('a')],
      edges: [],
    })
  })

  it('applies an explicit whole-graph restore including an empty graph', () => {
    expect(
      applyServerGraphChange({ nodes: [node('a')], edges: [] }, null, { nodes: [], edges: [] }),
    ).toEqual({ nodes: [], edges: [] })
  })
})
