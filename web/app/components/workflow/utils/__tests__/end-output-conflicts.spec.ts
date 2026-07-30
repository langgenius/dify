import type { Edge, Node } from '../../types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { BlockEnum } from '../../types'
import { getDuplicateEndOutputVariables } from '../end-output-conflicts'

beforeEach(() => {
  resetFixtureCounters()
})

const start = (id = 'start') => createNode({ id, data: { type: BlockEnum.Start, title: 'Start' } })

const ifElse = (id: string) =>
  createNode({ id, data: { type: BlockEnum.IfElse, title: 'If/Else' } })

const end = (id: string, variables: string[]) =>
  createNode({
    id,
    data: {
      type: BlockEnum.End,
      title: id,
      outputs: variables.map((variable) => ({ variable, value_selector: ['sys', variable] })),
    },
  })

const link = (source: string, target: string, sourceHandle?: string) =>
  createEdge({ source, target, ...(sourceHandle ? { sourceHandle } : {}) })

const conflictsOf = (nodes: Node[], edges: Edge[]) =>
  Object.fromEntries(getDuplicateEndOutputVariables(nodes, edges))

describe('getDuplicateEndOutputVariables', () => {
  it('should report nothing when output variable names are unique', () => {
    const nodes = [start(), end('end-1', ['a']), end('end-2', ['b'])]
    const edges = [link('start', 'end-1'), link('start', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should report Output nodes that run in parallel and share a variable name', () => {
    const nodes = [start(), end('end-1', ['result']), end('end-2', ['result'])]
    const edges = [link('start', 'end-1'), link('start', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({
      'end-1': ['result'],
      'end-2': ['result'],
    })
  })

  it('should allow the same variable name on both sides of an if/else', () => {
    const nodes = [start(), ifElse('branch'), end('end-1', ['result']), end('end-2', ['result'])]
    const edges = [
      link('start', 'branch'),
      link('branch', 'end-1', 'true'),
      link('branch', 'end-2', 'false'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name across a success and a fail branch', () => {
    const nodes = [
      start(),
      createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [
      link('start', 'llm'),
      link('llm', 'end-1', 'source'),
      link('llm', 'end-2', 'fail-branch'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name when several classifier classes merge into one Output node', () => {
    const nodes = [
      start(),
      createNode({ id: 'classifier', data: { type: BlockEnum.QuestionClassifier, title: 'Q' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [
      link('start', 'classifier'),
      link('classifier', 'end-1', 'class-1'),
      link('classifier', 'end-1', 'class-2'),
      link('classifier', 'end-2', 'class-3'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should report a conflict when one Output node bypasses the branch entirely', () => {
    const nodes = [start(), ifElse('branch'), end('end-1', ['result']), end('end-2', ['result'])]
    const edges = [link('start', 'branch'), link('branch', 'end-1', 'true'), link('start', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({
      'end-1': ['result'],
      'end-2': ['result'],
    })
  })

  it('should allow the same variable name on Output nodes reached through nested branches', () => {
    const nodes = [
      start(),
      ifElse('outer'),
      ifElse('inner'),
      end('end-1', ['result']),
      end('end-2', ['result']),
      end('end-3', ['result']),
    ]
    const edges = [
      link('start', 'outer'),
      link('outer', 'inner', 'true'),
      link('inner', 'end-1', 'true'),
      link('inner', 'end-2', 'false'),
      link('outer', 'end-3', 'false'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name on Output nodes behind a chain of if/else nodes', () => {
    const nodes = [
      start(),
      ifElse('first'),
      ifElse('second'),
      end('end-1', ['result']),
      end('end-2', ['result']),
      end('end-3', ['result']),
    ]
    const edges = [
      link('start', 'first'),
      link('first', 'end-1', 'true'),
      link('first', 'second', 'false'),
      link('second', 'end-2', 'true'),
      link('second', 'end-3', 'false'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name across a human input action and its timeout', () => {
    const nodes = [
      start(),
      createNode({ id: 'human', data: { type: BlockEnum.HumanInput, title: 'Human Input' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [
      link('start', 'human'),
      link('human', 'end-1', 'action-approve'),
      link('human', 'end-2', '__timeout'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name when Output nodes share a fallback Output node', () => {
    // `ok` needs first=true and second=true, while `err` is reached from either failure path, so the
    // two can still never run together.
    const nodes = [
      start(),
      ifElse('first'),
      ifElse('second'),
      end('ok', ['result']),
      end('err', ['result']),
    ]
    const edges = [
      link('start', 'first'),
      link('first', 'second', 'true'),
      link('first', 'err', 'false'),
      link('second', 'ok', 'true'),
      link('second', 'err', 'false'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name when a fail branch joins an if/else failure path', () => {
    const nodes = [
      start(),
      createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM' } }),
      ifElse('branch'),
      end('ok', ['result']),
      end('err', ['result']),
    ]
    const edges = [
      link('start', 'llm'),
      link('llm', 'branch', 'source'),
      link('llm', 'err', 'fail-branch'),
      link('branch', 'ok', 'true'),
      link('branch', 'err', 'false'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should ignore the temporary edges added while highlighting variable dependencies', () => {
    const nodes = [start(), ifElse('branch'), end('end-1', ['result']), end('end-2', ['result'])]
    const edges = [
      link('start', 'branch'),
      link('branch', 'end-1', 'true'),
      link('branch', 'end-2', 'false'),
      createEdge({
        source: 'start',
        target: 'end-1',
        sourceHandle: 'source_tmp',
        data: { _isTemp: true },
      }),
      createEdge({
        source: 'start',
        target: 'end-2',
        sourceHandle: 'source_tmp',
        data: { _isTemp: true },
      }),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should allow the same variable name on Output nodes belonging to different entry nodes', () => {
    const nodes = [
      start('start-a'),
      createNode({ id: 'start-b', data: { type: BlockEnum.TriggerWebhook, title: 'Webhook' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [link('start-a', 'end-1'), link('start-b', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should report a variable declared twice by the same Output node', () => {
    const nodes = [start(), end('end-1', ['result', 'result'])]
    const edges = [link('start', 'end-1')]

    expect(conflictsOf(nodes, edges)).toEqual({ 'end-1': ['result'] })
  })

  it('should ignore blank variable names', () => {
    const nodes = [start(), end('end-1', ['', '  ']), end('end-2', ['', '  '])]
    const edges = [link('start', 'end-1'), link('start', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should report only the variable names that actually collide', () => {
    const nodes = [start(), end('end-1', ['shared', 'only-a']), end('end-2', ['shared', 'only-b'])]
    const edges = [link('start', 'end-1'), link('start', 'end-2')]

    expect(conflictsOf(nodes, edges)).toEqual({
      'end-1': ['shared'],
      'end-2': ['shared'],
    })
  })

  it('should compare Output nodes only within their own scope', () => {
    const nodes = [
      start(),
      createNode({ id: 'loop', data: { type: BlockEnum.Loop, title: 'Loop' } }),
      end('end-1', ['result']),
      createNode({
        id: 'end-2',
        parentId: 'loop',
        data: {
          type: BlockEnum.End,
          title: 'end-2',
          outputs: [{ variable: 'result', value_selector: ['sys', 'result'] }],
        },
      }),
    ]
    const edges = [link('start', 'loop'), link('loop', 'end-1')]

    expect(conflictsOf(nodes, edges)).toEqual({})
  })

  it('should terminate and report a conflict when the graph contains a cycle', () => {
    const nodes = [
      start(),
      createNode({ id: 'a', data: { type: BlockEnum.Code, title: 'A' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: 'B' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [
      link('start', 'a'),
      link('a', 'b'),
      link('b', 'a'),
      link('a', 'end-1'),
      link('b', 'end-2'),
    ]

    expect(conflictsOf(nodes, edges)).toEqual({
      'end-1': ['result'],
      'end-2': ['result'],
    })
  })

  it('should report a conflict for Output nodes that are not connected to an entry node', () => {
    const nodes = [start(), end('end-1', ['result']), end('end-2', ['result'])]

    expect(conflictsOf(nodes, [])).toEqual({
      'end-1': ['result'],
      'end-2': ['result'],
    })
  })

  it('should not treat a dangling Output node as its own entry point in a flow without a start node', () => {
    const nodes = [
      createNode({ id: 'data-source', data: { type: BlockEnum.DataSource, title: 'Source' } }),
      end('end-1', ['result']),
      end('end-2', ['result']),
    ]
    const edges = [link('data-source', 'end-1')]

    expect(conflictsOf(nodes, edges)).toEqual({
      'end-1': ['result'],
      'end-2': ['result'],
    })
  })
})
