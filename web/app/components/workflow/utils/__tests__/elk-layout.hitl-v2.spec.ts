import type { CommonEdgeType, CommonNodeType, Edge, Node } from '../../types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum } from '../../types'

type ElkChild = Record<string, unknown> & {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  children?: ElkChild[]
  ports?: Array<{ id: string; layoutOptions?: Record<string, string> }>
  layoutOptions?: Record<string, string>
}
type ElkGraph = Record<string, unknown> & {
  id: string
  children?: ElkChild[]
  edges?: Array<Record<string, unknown>>
}

let layoutCallArgs: ElkGraph | null = null
let mockReturnOverride: ((graph: ElkGraph) => ElkGraph) | null = null

vi.mock('elkjs/lib/elk.bundled.js', () => {
  return {
    default: class MockELK {
      async layout(graph: ElkGraph) {
        layoutCallArgs = graph
        if (mockReturnOverride) return mockReturnOverride(graph)

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

const { getLayoutByELK } = await import('../elk-layout')

function makeWorkflowNode(
  overrides: Omit<Partial<Node>, 'data'> & {
    data?: Partial<CommonNodeType> & Record<string, unknown>
  } = {},
): Node {
  return createNode({
    type: CUSTOM_NODE,
    ...overrides,
  })
}

function makeWorkflowEdge(
  overrides: Omit<Partial<Edge>, 'data'> & {
    data?: Partial<CommonEdgeType> & Record<string, unknown>
  } = {},
): Edge {
  return createEdge(overrides)
}

beforeEach(() => {
  resetFixtureCounters()
  layoutCallArgs = null
  mockReturnOverride = null
})

describe('getLayoutByELK', () => {
  it('should sort Human Input v2 action edges with __timeout last', async () => {
    const nodes = [
      makeWorkflowNode({
        id: 'hi-1',
        data: {
          type: BlockEnum.HumanInput,
          version: '2',
          title: '',
          desc: '',
          recipients_spec: [{ type: 'initiator' }],
          message_template: { subject: 'Review', body: 'Body' },
          debug_mode: { enabled: false, channels: [] },
          form_content: '',
          inputs: [],
          user_actions: [{ id: 'a1' }, { id: 'a2' }],
          timeout: 36,
          timeout_unit: 'hour',
        },
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
})
