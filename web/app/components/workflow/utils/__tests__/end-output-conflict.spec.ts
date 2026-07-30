import type { Edge, Node } from '../../types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { BlockEnum } from '../../types'
import { getConflictingEndOutputVariables } from '../end-output-conflict'

beforeEach(() => {
  resetFixtureCounters()
})

const startNode = (id = 'start') => createNode({ id, data: { type: BlockEnum.Start, title: id } })

const triggerNode = (id: string) =>
  createNode({ id, data: { type: BlockEnum.TriggerWebhook, title: id } })

const endNode = (id: string, variables: string[]) =>
  createNode({
    id,
    data: {
      type: BlockEnum.End,
      title: id,
      outputs: variables.map((variable) => ({ variable, value_selector: ['sys', variable] })),
    },
  })

const branchNode = (id: string, type: BlockEnum) => createNode({ id, data: { type, title: id } })

const edge = (source: string, target: string, sourceHandle?: string): Edge =>
  createEdge({ source, target, sourceHandle })

const conflictsFor = (nodes: Node[], edges: Edge[]) => {
  const map = getConflictingEndOutputVariables(nodes, edges)
  return {
    has: (nodeId: string, variable: string) => map.get(nodeId)?.has(variable) ?? false,
    size: map.size,
  }
}

describe('getConflictingEndOutputVariables', () => {
  it('flags identical variables on two parallel end nodes (same handle fork)', () => {
    const nodes = [startNode(), endNode('end-1', ['answer']), endNode('end-2', ['answer'])]
    const edges = [edge('start', 'end-1'), edge('start', 'end-2')]

    const { has } = conflictsFor(nodes, edges)
    expect(has('end-1', 'answer')).toBe(true)
    expect(has('end-2', 'answer')).toBe(true)
  })

  it('does NOT flag identical variables on mutually exclusive IfElse branches', () => {
    const nodes = [
      startNode(),
      branchNode('if', BlockEnum.IfElse),
      endNode('end-true', ['answer']),
      endNode('end-false', ['answer']),
    ]
    const edges = [
      edge('start', 'if'),
      edge('if', 'end-true', 'true'),
      edge('if', 'end-false', 'false'),
    ]

    expect(conflictsFor(nodes, edges).size).toBe(0)
  })

  it('does NOT flag identical variables on distinct QuestionClassifier classes', () => {
    const nodes = [
      startNode(),
      branchNode('qc', BlockEnum.QuestionClassifier),
      endNode('end-a', ['answer']),
      endNode('end-b', ['answer']),
    ]
    const edges = [
      edge('start', 'qc'),
      edge('qc', 'end-a', 'class-1'),
      edge('qc', 'end-b', 'class-2'),
    ]

    expect(conflictsFor(nodes, edges).size).toBe(0)
  })

  it('does NOT flag success vs fail-branch of the same node', () => {
    const nodes = [
      startNode(),
      branchNode('llm', BlockEnum.LLM),
      endNode('end-ok', ['answer']),
      endNode('end-err', ['answer']),
    ]
    const edges = [
      edge('start', 'llm'),
      edge('llm', 'end-ok'), // default 'source' handle
      edge('llm', 'end-err', 'fail-branch'),
    ]

    expect(conflictsFor(nodes, edges).size).toBe(0)
  })

  it('flags ends that re-merge after an IfElse before splitting again', () => {
    // if(true|false) -> merge -> end-1 AND end-2 (parallel after the merge)
    const nodes = [
      startNode(),
      branchNode('if', BlockEnum.IfElse),
      branchNode('merge', BlockEnum.Code),
      endNode('end-1', ['answer']),
      endNode('end-2', ['answer']),
    ]
    const edges = [
      edge('start', 'if'),
      edge('if', 'merge', 'true'),
      edge('if', 'merge', 'false'),
      edge('merge', 'end-1'),
      edge('merge', 'end-2'),
    ]

    const { has } = conflictsFor(nodes, edges)
    expect(has('end-1', 'answer')).toBe(true)
    expect(has('end-2', 'answer')).toBe(true)
  })

  it('does NOT flag ends behind disjoint triggers (separate runs)', () => {
    const nodes = [
      startNode('start-a'),
      triggerNode('start-b'),
      endNode('end-a', ['answer']),
      endNode('end-b', ['answer']),
    ]
    const edges = [edge('start-a', 'end-a'), edge('start-b', 'end-b')]

    expect(conflictsFor(nodes, edges).size).toBe(0)
  })

  it('flags a variable repeated within a single end node', () => {
    const nodes = [startNode(), endNode('end-1', ['answer', 'answer'])]
    const edges = [edge('start', 'end-1')]

    expect(conflictsFor(nodes, edges).has('end-1', 'answer')).toBe(true)
  })

  it('handles more than two ends: exclusive cases pass, parallel pair fails', () => {
    // if.true -> end-1 ; if.false -> (parallel) end-2 + end-3
    const nodes = [
      startNode(),
      branchNode('if', BlockEnum.IfElse),
      branchNode('fork', BlockEnum.Code),
      endNode('end-1', ['answer']),
      endNode('end-2', ['answer']),
      endNode('end-3', ['answer']),
    ]
    const edges = [
      edge('start', 'if'),
      edge('if', 'end-1', 'true'),
      edge('if', 'fork', 'false'),
      edge('fork', 'end-2'),
      edge('fork', 'end-3'),
    ]

    const { has } = conflictsFor(nodes, edges)
    // end-1 is exclusive with both others -> never flagged
    expect(has('end-1', 'answer')).toBe(false)
    // end-2 and end-3 run together under the false branch -> flagged
    expect(has('end-2', 'answer')).toBe(true)
    expect(has('end-3', 'answer')).toBe(true)
  })

  it('does not flag different variable names', () => {
    const nodes = [startNode(), endNode('end-1', ['a']), endNode('end-2', ['b'])]
    const edges = [edge('start', 'end-1'), edge('start', 'end-2')]

    expect(conflictsFor(nodes, edges).size).toBe(0)
  })

  it('only flags the shared variable when ends mix shared and unique names', () => {
    const nodes = [
      startNode(),
      endNode('end-1', ['shared', 'only1']),
      endNode('end-2', ['shared', 'only2']),
    ]
    const edges = [edge('start', 'end-1'), edge('start', 'end-2')]

    const { has } = conflictsFor(nodes, edges)
    expect(has('end-1', 'shared')).toBe(true)
    expect(has('end-2', 'shared')).toBe(true)
    expect(has('end-1', 'only1')).toBe(false)
    expect(has('end-2', 'only2')).toBe(false)
  })
})
