import type { CommonEdgeType, CommonNodeType, Edge, Node } from '../../types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { CUSTOM_NODE, NODE_LAYOUT_HORIZONTAL_PADDING } from '../../constants'
import { CUSTOM_ITERATION_START_NODE } from '../../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../../nodes/loop-start/constants'
import { BlockEnum } from '../../types'

type ElkChild = Record<string, unknown> & { id: string, width?: number, height?: number, x?: number, y?: number, children?: ElkChild[], ports?: Array<{ id: string, layoutOptions?: Record<string, string> }>, layoutOptions?: Record<string, string> }
type ElkGraph = Record<string, unknown> & { id: string, children?: ElkChild[], edges?: Array<Record<string, unknown>> }

let layoutCallArgs: ElkGraph | null = null
let mockReturnOverride: ((graph: ElkGraph) => ElkGraph) | null = null

vi.mock('elkjs/lib/elk.bundled.js', () => {
  return {
    default: class MockELK {
      async layout(graph: ElkGraph) {
        layoutCallArgs = graph
        if (mockReturnOverride)
          return mockReturnOverride(graph)

        const children = (graph.children || []).map((child: ElkChild, i: number) => ({
          ...child,
          x: 100 + i * 300,
          y: 50 + i * 100,
          width: child.width || 244,
          height: child.height || 100,
        }))
        return { ...graph, children }
      }
    },
  }
})

const { getLayoutByELK, getLayoutForChildNodes } = await import('../elk-layout')

function makeWorkflowNode(overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {}): Node {
  return createNode({
    type: CUSTOM_NODE,
    ...overrides,
  })
}

function makeWorkflowEdge(overrides: Omit<Partial<Edge>, 'data'> & { data?: Partial<CommonEdgeType> & Record<string, unknown> } = {}): Edge {
  return createEdge(overrides)
}

beforeEach(() => {
  resetFixtureCounters()
  layoutCallArgs = null
  mockReturnOverride = null
})

describe('getLayoutByELK', () => {
  it('should return layout for simple linear graph', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [makeWorkflowEdge({ source: 'a', target: 'b' })]

    const result = await getLayoutByELK(nodes, edges)

    expect(result.nodes.size).toBe(2)
    expect(result.nodes.has('a')).toBe(true)
    expect(result.nodes.has('b')).toBe(true)
    expect(result.bounds.minX).toBe(0)
    expect(result.bounds.minY).toBe(0)
  })

  it('should filter out nodes with parentId', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'child', data: { type: BlockEnum.Code, title: '', desc: '' }, parentId: 'a' }),
    ]

    const result = await getLayoutByELK(nodes, [])
    expect(result.nodes.size).toBe(1)
    expect(result.nodes.has('child')).toBe(false)
  })

  it('should filter out non-CUSTOM_NODE type nodes', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'iter-start', type: CUSTOM_ITERATION_START_NODE, data: { type: BlockEnum.IterationStart, title: '', desc: '' } }),
    ]

    const result = await getLayoutByELK(nodes, [])
    expect(result.nodes.size).toBe(1)
  })

  it('should filter out iteration/loop internal edges', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'a', target: 'b', data: { isInIteration: true, iteration_id: 'iter-1' } }),
    ]

    await getLayoutByELK(nodes, edges)
    expect(layoutCallArgs!.edges).toHaveLength(0)
  })

  it('should use default dimensions when node has no width/height', async () => {
    const node = makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    Reflect.deleteProperty(node, 'width')
    Reflect.deleteProperty(node, 'height')

    const result = await getLayoutByELK([node], [])
    expect(result.nodes.size).toBe(1)
    const info = result.nodes.get('a')!
    expect(info.width).toBe(244)
    expect(info.height).toBe(100)
  })

  it('should build ports for IfElse nodes with multiple branches', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          cases: [{ case_id: 'case-1', logical_operator: 'and', conditions: [] }],
        },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b', sourceHandle: 'case-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c', sourceHandle: 'false' }),
    ]

    await getLayoutByELK(nodes, edges)
    const ifElkNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    expect(ifElkNode.ports).toHaveLength(2)
    expect(ifElkNode.layoutOptions!['elk.portConstraints']).toBe('FIXED_ORDER')
  })

  it('should build ports for IfElse even with single branch', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [{ case_id: 'case-1' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [makeWorkflowEdge({ source: 'if-1', target: 'b', sourceHandle: 'case-1' })]

    await getLayoutByELK(nodes, edges)
    const ifElkNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    expect(ifElkNode.ports).toHaveLength(1)
    expect(ifElkNode.ports![0].layoutOptions!['elk.port.side']).toBe('EAST')
  })

  it('should build ports for HumanInput nodes with multiple branches', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: { type: BlockEnum.HumanInput, title: '', desc: '', user_actions: [{ id: 'action-1' }, { id: 'action-2' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'hi-1', target: 'b', sourceHandle: 'action-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'hi-1', target: 'c', sourceHandle: '__timeout' }),
    ]

    await getLayoutByELK(nodes, edges)
    const hiElkNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    expect(hiElkNode.ports).toHaveLength(2)
  })

  it('should build ports for HumanInput even with single branch', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: { type: BlockEnum.HumanInput, title: '', desc: '', user_actions: [{ id: 'action-1' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [makeWorkflowEdge({ source: 'hi-1', target: 'b', sourceHandle: 'action-1' })]

    await getLayoutByELK(nodes, edges)
    const hiElkNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    expect(hiElkNode.ports).toHaveLength(1)
    expect(hiElkNode.ports![0].layoutOptions!['elk.port.side']).toBe('EAST')
  })

  it('should normalise bounds so minX and minY start at 0', async () => {
    const nodes = [makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })]
    const result = await getLayoutByELK(nodes, [])
    expect(result.bounds.minX).toBe(0)
    expect(result.bounds.minY).toBe(0)
  })

  it('should return empty layout when no nodes match filter', async () => {
    const result = await getLayoutByELK([], [])
    expect(result.nodes.size).toBe(0)
    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('should sort IfElse edges with false (ELSE) last', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          cases: [
            { case_id: 'case-a', logical_operator: 'and', conditions: [] },
            { case_id: 'case-b', logical_operator: 'and', conditions: [] },
          ],
        },
      }),
      makeWorkflowNode({ id: 'x', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'y', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'z', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e-else', source: 'if-1', target: 'z', sourceHandle: 'false' }),
      makeWorkflowEdge({ id: 'e-a', source: 'if-1', target: 'x', sourceHandle: 'case-a' }),
      makeWorkflowEdge({ id: 'e-b', source: 'if-1', target: 'y', sourceHandle: 'case-b' }),
    ]

    await getLayoutByELK(nodes, edges)
    const ifNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    const portIds = ifNode.ports!.map((p: { id: string }) => p.id)
    expect(portIds[portIds.length - 1]).toContain('false')
  })

  it('should sort HumanInput edges with __timeout last', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: { type: BlockEnum.HumanInput, title: '', desc: '', user_actions: [{ id: 'a1' }, { id: 'a2' }] },
      }),
      makeWorkflowNode({ id: 'x', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'y', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'z', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e-timeout', source: 'hi-1', target: 'z', sourceHandle: '__timeout' }),
      makeWorkflowEdge({ id: 'e-a1', source: 'hi-1', target: 'x', sourceHandle: 'a1' }),
      makeWorkflowEdge({ id: 'e-a2', source: 'hi-1', target: 'y', sourceHandle: 'a2' }),
    ]

    await getLayoutByELK(nodes, edges)
    const hiNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    const portIds = hiNode.ports!.map((p: { id: string }) => p.id)
    expect(portIds[portIds.length - 1]).toContain('__timeout')
  })

  it('should assign sourcePort to edges from IfElse nodes with ports', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [{ case_id: 'case-1' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b', sourceHandle: 'case-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c', sourceHandle: 'false' }),
    ]

    await getLayoutByELK(nodes, edges)
    const portEdges = layoutCallArgs!.edges!.filter((e: Record<string, unknown>) => e.sourcePort)
    expect(portEdges.length).toBeGreaterThan(0)
  })

  it('should handle edges without sourceHandle for ports (use index)', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const e1 = makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b' })
    const e2 = makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c' })
    Reflect.deleteProperty(e1, 'sourceHandle')
    Reflect.deleteProperty(e2, 'sourceHandle')

    const result = await getLayoutByELK(nodes, [e1, e2])
    expect(result.nodes.size).toBeGreaterThan(0)
  })

  it('should handle collectLayout with null x/y/width/height values', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: (graph.children || []).map((child: ElkChild) => ({
        id: child.id,
      })),
    })

    const nodes = [makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })]
    const result = await getLayoutByELK(nodes, [])
    const info = result.nodes.get('a')!
    expect(info.x).toBe(0)
    expect(info.y).toBe(0)
    expect(info.width).toBe(244)
    expect(info.height).toBe(100)
  })

  it('should parse layer index from layoutOptions', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: (graph.children || []).map((child: ElkChild, i: number) => ({
        ...child,
        x: i * 300,
        y: 0,
        width: 244,
        height: 100,
        layoutOptions: {
          'org.eclipse.elk.layered.layerIndex': String(i),
        },
      })),
    })

    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = await getLayoutByELK(nodes, [])
    expect(result.nodes.get('a')!.layer).toBe(0)
    expect(result.nodes.get('b')!.layer).toBe(1)
  })

  it('should handle collectLayout with nested children', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: [
        {
          id: 'parent-node',
          x: 0,
          y: 0,
          width: 500,
          height: 400,
          children: [
            { id: 'nested-1', x: 10, y: 10, width: 200, height: 100 },
            { id: 'nested-2', x: 10, y: 120, width: 200, height: 100 },
          ],
        },
      ],
    })

    const nodes = [
      makeWorkflowNode({ id: 'parent-node', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'nested-1', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'nested-2', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = await getLayoutByELK(nodes, [])
    expect(result.nodes.has('nested-1')).toBe(true)
    expect(result.nodes.has('nested-2')).toBe(true)
  })

  it('should handle collectLayout with predicate filtering some children', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: [
        { id: 'visible', x: 0, y: 0, width: 200, height: 100 },
        { id: 'also-visible', x: 300, y: 0, width: 200, height: 100 },
      ],
    })

    const nodes = [
      makeWorkflowNode({ id: 'visible', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'also-visible', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = await getLayoutByELK(nodes, [])
    expect(result.nodes.size).toBe(2)
  })

  it('should sort IfElse edges where case not found in cases array', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [{ case_id: 'known-case' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b', sourceHandle: 'unknown-case' }),
      makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c', sourceHandle: 'other-unknown' }),
    ]

    await getLayoutByELK(nodes, edges)
    const ifNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    expect(ifNode.ports).toHaveLength(2)
  })

  it('should sort HumanInput edges where action not found in user_actions', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: { type: BlockEnum.HumanInput, title: '', desc: '', user_actions: [{ id: 'known-action' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'hi-1', target: 'b', sourceHandle: 'unknown-action' }),
      makeWorkflowEdge({ id: 'e2', source: 'hi-1', target: 'c', sourceHandle: 'another-unknown' }),
    ]

    await getLayoutByELK(nodes, edges)
    const hiNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    expect(hiNode.ports).toHaveLength(2)
  })

  it('should handle IfElse edges without handles (no sourceHandle)', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const e1 = makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b' })
    const e2 = makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c' })
    Reflect.deleteProperty(e1, 'sourceHandle')
    Reflect.deleteProperty(e2, 'sourceHandle')

    await getLayoutByELK(nodes, [e1, e2])
    const ifNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    expect(ifNode.ports).toHaveLength(2)
  })

  it('should handle HumanInput edges without handles', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: { type: BlockEnum.HumanInput, title: '', desc: '', user_actions: [] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const e1 = makeWorkflowEdge({ id: 'e1', source: 'hi-1', target: 'b' })
    const e2 = makeWorkflowEdge({ id: 'e2', source: 'hi-1', target: 'c' })
    Reflect.deleteProperty(e1, 'sourceHandle')
    Reflect.deleteProperty(e2, 'sourceHandle')

    await getLayoutByELK(nodes, [e1, e2])
    const hiNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    expect(hiNode.ports).toHaveLength(2)
  })

  it('should handle IfElse with no cases property', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'if-1', data: { type: BlockEnum.IfElse, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'if-1', target: 'b', sourceHandle: 'true' }),
      makeWorkflowEdge({ id: 'e2', source: 'if-1', target: 'c', sourceHandle: 'false' }),
    ]

    await getLayoutByELK(nodes, edges)
    const ifNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'if-1')!
    expect(ifNode.ports).toHaveLength(2)
  })

  it('should handle HumanInput with no user_actions property', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'hi-1', data: { type: BlockEnum.HumanInput, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'hi-1', target: 'b', sourceHandle: 'action-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'hi-1', target: 'c', sourceHandle: '__timeout' }),
    ]

    await getLayoutByELK(nodes, edges)
    const hiNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'hi-1')!
    expect(hiNode.ports).toHaveLength(2)
  })

  it('should build ports for QuestionClassifier sorted by classes order', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'qc-1',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: '',
          desc: '',
          classes: [{ id: 'cls-a', name: 'A' }, { id: 'cls-b', name: 'B' }, { id: 'cls-c', name: 'C' }],
        },
      }),
      makeWorkflowNode({ id: 'x', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'y', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'z', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e-c', source: 'qc-1', target: 'z', sourceHandle: 'cls-c' }),
      makeWorkflowEdge({ id: 'e-a', source: 'qc-1', target: 'x', sourceHandle: 'cls-a' }),
      makeWorkflowEdge({ id: 'e-b', source: 'qc-1', target: 'y', sourceHandle: 'cls-b' }),
    ]

    await getLayoutByELK(nodes, edges)
    const qcNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'qc-1')!
    const portIds = qcNode.ports!.map((p: { id: string }) => p.id)
    expect(portIds).toEqual([
      'qc-1-out-cls-a',
      'qc-1-out-cls-b',
      'qc-1-out-cls-c',
    ])
  })

  it('should build ports for QuestionClassifier with single class', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'qc-1',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: '',
          desc: '',
          classes: [{ id: 'cls-only', name: 'Only' }],
        },
      }),
      makeWorkflowNode({ id: 'x', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'qc-1', target: 'x', sourceHandle: 'cls-only' }),
    ]

    await getLayoutByELK(nodes, edges)
    const qcNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'qc-1')!
    expect(qcNode.ports).toHaveLength(1)
    expect(qcNode.ports![0].layoutOptions!['elk.port.side']).toBe('EAST')
  })

  it('should only create output (EAST) ports, not input (WEST) ports', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.End, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'a', target: 'b' }),
      makeWorkflowEdge({ id: 'e2', source: 'b', target: 'c' }),
    ]

    await getLayoutByELK(nodes, edges)
    layoutCallArgs!.children!.forEach((child: ElkChild) => {
      if (child.ports) {
        child.ports.forEach((port) => {
          expect(port.layoutOptions!['elk.port.side']).toBe('EAST')
        })
      }
    })
    const endNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'c')!
    expect(endNode.ports).toBeUndefined()
  })

  it('should order children array by DFS following port order', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          cases: [{ case_id: 'case-a', logical_operator: 'and', conditions: [] }],
        },
      }),
      makeWorkflowNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'branch-a', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'branch-else', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'end', data: { type: BlockEnum.End, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'start', target: 'if-1' }),
      makeWorkflowEdge({ id: 'e-else', source: 'if-1', target: 'branch-else', sourceHandle: 'false' }),
      makeWorkflowEdge({ id: 'e-a', source: 'if-1', target: 'branch-a', sourceHandle: 'case-a' }),
      makeWorkflowEdge({ source: 'branch-a', target: 'end' }),
      makeWorkflowEdge({ source: 'branch-else', target: 'end' }),
    ]

    await getLayoutByELK(nodes, edges)
    const childIds = layoutCallArgs!.children!.map((c: ElkChild) => c.id)
    // DFS from start: start → if-1 → branch-a (case-a first) → end → branch-else
    const idxA = childIds.indexOf('branch-a')
    const idxElse = childIds.indexOf('branch-else')
    expect(idxA).toBeLessThan(idxElse)
  })

  it('should order children by DFS across nested branching nodes', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({
        id: 'qc-1',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: '',
          desc: '',
          classes: [{ id: 'c1', name: 'C1' }, { id: 'c2', name: 'C2' }],
        },
      }),
      makeWorkflowNode({ id: 'upper', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'lower', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'start', target: 'qc-1' }),
      makeWorkflowEdge({ id: 'e-c2', source: 'qc-1', target: 'lower', sourceHandle: 'c2' }),
      makeWorkflowEdge({ id: 'e-c1', source: 'qc-1', target: 'upper', sourceHandle: 'c1' }),
    ]

    await getLayoutByELK(nodes, edges)
    const childIds = layoutCallArgs!.children!.map((c: ElkChild) => c.id)
    // DFS: start → qc-1 → upper (c1 first) → lower (c2 second)
    expect(childIds.indexOf('upper')).toBeLessThan(childIds.indexOf('lower'))
  })

  it('should handle QuestionClassifier with no classes property', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'qc-1', data: { type: BlockEnum.QuestionClassifier, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'qc-1', target: 'b', sourceHandle: 'cls-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'qc-1', target: 'c', sourceHandle: 'cls-2' }),
    ]

    await getLayoutByELK(nodes, edges)
    const qcNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'qc-1')!
    expect(qcNode.ports).toHaveLength(2)
  })

  it('should handle QuestionClassifier edges where handle not found in classes', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'qc-1',
        data: { type: BlockEnum.QuestionClassifier, title: '', desc: '', classes: [{ id: 'known', name: 'K' }] },
      }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e1', source: 'qc-1', target: 'b', sourceHandle: 'unknown-1' }),
      makeWorkflowEdge({ id: 'e2', source: 'qc-1', target: 'c', sourceHandle: 'unknown-2' }),
    ]

    await getLayoutByELK(nodes, edges)
    const qcNode = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'qc-1')!
    expect(qcNode.ports).toHaveLength(2)
  })

  it('should include disconnected nodes in the layout', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'connected', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'isolated', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'start', target: 'connected' }),
    ]

    await getLayoutByELK(nodes, edges)
    const childIds = layoutCallArgs!.children!.map((c: ElkChild) => c.id)
    expect(childIds).toContain('isolated')
    expect(childIds).toHaveLength(3)
  })

  it('should build edges in DFS order matching port order', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [{ case_id: 'case-a' }] },
      }),
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'start', target: 'if-1' }),
      makeWorkflowEdge({ id: 'e-else', source: 'if-1', target: 'b', sourceHandle: 'false' }),
      makeWorkflowEdge({ id: 'e-a', source: 'if-1', target: 'a', sourceHandle: 'case-a' }),
    ]

    await getLayoutByELK(nodes, edges)
    const elkEdges = layoutCallArgs!.edges as Array<{ sources: string[], targets: string[] }>
    const ifEdges = elkEdges.filter(e => e.sources[0] === 'if-1')
    expect(ifEdges[0].targets[0]).toBe('a')
    expect(ifEdges[1].targets[0]).toBe('b')
  })

  it('should keep edges for components where every node has an incoming edge', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'if-1',
        data: { type: BlockEnum.IfElse, title: '', desc: '', cases: [{ case_id: 'case-a' }] },
      }),
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ id: 'e-a', source: 'if-1', target: 'a', sourceHandle: 'case-a' }),
      makeWorkflowEdge({ id: 'e-b', source: 'if-1', target: 'b', sourceHandle: 'false' }),
      makeWorkflowEdge({ id: 'e-back', source: 'a', target: 'if-1' }),
    ]

    await getLayoutByELK(nodes, edges)

    const elkEdges = layoutCallArgs!.edges as Array<{ sources: string[], targets: string[] }>
    expect(elkEdges).toHaveLength(3)
    expect(elkEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sources: ['if-1'], targets: ['a'] }),
      expect.objectContaining({ sources: ['if-1'], targets: ['b'] }),
      expect.objectContaining({ sources: ['a'], targets: ['if-1'] }),
    ]))
  })

  it('should filter loop internal edges', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'x', target: 'y', data: { isInLoop: true, loop_id: 'loop-1' } }),
    ]

    await getLayoutByELK(nodes, edges)
    expect(layoutCallArgs!.edges).toHaveLength(0)
  })
})

describe('getLayoutForChildNodes', () => {
  it('should return null when no child nodes exist', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'parent', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
    ]
    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).toBeNull()
  })

  it('should layout child nodes of an iteration', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'parent', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
      makeWorkflowNode({
        id: 'iter-start',
        type: CUSTOM_ITERATION_START_NODE,
        parentId: 'parent',
        data: { type: BlockEnum.IterationStart, title: '', desc: '' },
      }),
      makeWorkflowNode({ id: 'child-1', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'iter-start', target: 'child-1', data: { isInIteration: true, iteration_id: 'parent' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, edges)
    expect(result).not.toBeNull()
    expect(result!.nodes.size).toBe(2)
    expect(result!.bounds.minX).toBe(0)
  })

  it('should layout child nodes of a loop', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'loop-p', data: { type: BlockEnum.Loop, title: '', desc: '' } }),
      makeWorkflowNode({
        id: 'loop-start',
        type: CUSTOM_LOOP_START_NODE,
        parentId: 'loop-p',
        data: { type: BlockEnum.LoopStart, title: '', desc: '' },
      }),
      makeWorkflowNode({ id: 'loop-child', parentId: 'loop-p', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'loop-start', target: 'loop-child', data: { isInLoop: true, loop_id: 'loop-p' } }),
    ]

    const result = await getLayoutForChildNodes('loop-p', nodes, edges)
    expect(result).not.toBeNull()
    expect(result!.nodes.size).toBe(2)
  })

  it('should only include edges belonging to the parent iteration', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'child-a', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'child-b', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'child-a', target: 'child-b', data: { isInIteration: true, iteration_id: 'parent' } }),
      makeWorkflowEdge({ source: 'x', target: 'y', data: { isInIteration: true, iteration_id: 'other-parent' } }),
    ]

    await getLayoutForChildNodes('parent', nodes, edges)
    expect(layoutCallArgs!.edges).toHaveLength(1)
  })

  it('should adjust start node position when x exceeds horizontal padding', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: (graph.children || []).map((child: ElkChild, i: number) => ({
        ...child,
        x: 200 + i * 300,
        y: 50,
        width: 244,
        height: 100,
      })),
    })

    const nodes = [
      makeWorkflowNode({
        id: 'start',
        type: CUSTOM_ITERATION_START_NODE,
        parentId: 'parent',
        data: { type: BlockEnum.IterationStart, title: '', desc: '' },
      }),
      makeWorkflowNode({ id: 'child', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
    const startInfo = result!.nodes.get('start')!
    expect(startInfo.x).toBeLessThanOrEqual(NODE_LAYOUT_HORIZONTAL_PADDING / 1.5 + 1)
  })

  it('should not shift when start node x is already within padding', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: (graph.children || []).map((child: ElkChild, i: number) => ({
        ...child,
        x: 10 + i * 300,
        y: 50,
        width: 244,
        height: 100,
      })),
    })

    const nodes = [
      makeWorkflowNode({
        id: 'start',
        type: CUSTOM_ITERATION_START_NODE,
        parentId: 'parent',
        data: { type: BlockEnum.IterationStart, title: '', desc: '' },
      }),
      makeWorkflowNode({ id: 'child', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
  })

  it('should handle child nodes identified by data type LoopStart', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'ls', parentId: 'parent', data: { type: BlockEnum.LoopStart, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'child', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
    expect(result!.nodes.size).toBe(2)
  })

  it('should handle child nodes identified by data type IterationStart', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'is', parentId: 'parent', data: { type: BlockEnum.IterationStart, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'child', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
    expect(result!.nodes.size).toBe(2)
  })

  it('should handle no start node in child layout', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'c1', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'c2', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
    expect(result!.nodes.size).toBe(2)
  })

  it('should build ports and DFS-order for branching nodes inside iteration', async () => {
    const nodes = [
      makeWorkflowNode({ id: 'parent', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
      makeWorkflowNode({
        id: 'iter-start',
        type: CUSTOM_ITERATION_START_NODE,
        parentId: 'parent',
        data: { type: BlockEnum.IterationStart, title: '', desc: '' },
      }),
      makeWorkflowNode({
        id: 'qc-child',
        parentId: 'parent',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: '',
          desc: '',
          classes: [{ id: 'cls-1', name: 'C1' }, { id: 'cls-2', name: 'C2' }],
        },
      }),
      makeWorkflowNode({ id: 'upper', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      makeWorkflowNode({ id: 'lower', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      makeWorkflowEdge({ source: 'iter-start', target: 'qc-child', data: { isInIteration: true, iteration_id: 'parent' } }),
      makeWorkflowEdge({ id: 'e-c2', source: 'qc-child', target: 'lower', sourceHandle: 'cls-2', data: { isInIteration: true, iteration_id: 'parent' } }),
      makeWorkflowEdge({ id: 'e-c1', source: 'qc-child', target: 'upper', sourceHandle: 'cls-1', data: { isInIteration: true, iteration_id: 'parent' } }),
    ]

    await getLayoutForChildNodes('parent', nodes, edges)

    const qcElk = layoutCallArgs!.children!.find((c: ElkChild) => c.id === 'qc-child')!
    expect(qcElk.ports).toHaveLength(2)
    expect(qcElk.ports![0].id).toContain('cls-1')
    expect(qcElk.ports![1].id).toContain('cls-2')

    const childIds = layoutCallArgs!.children!.map((c: ElkChild) => c.id)
    expect(childIds.indexOf('upper')).toBeLessThan(childIds.indexOf('lower'))
  })

  it('should return original layout when bounds are not finite', async () => {
    mockReturnOverride = (graph: ElkGraph) => ({
      ...graph,
      children: [],
    })

    const nodes = [
      makeWorkflowNode({ id: 'c1', parentId: 'parent', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const result = await getLayoutForChildNodes('parent', nodes, [])
    expect(result).not.toBeNull()
    expect(result!.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})
