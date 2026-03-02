import type { CommonEdgeType, CommonNodeType, Edge, Node } from '../types'
import { Position } from 'reactflow'
import { CUSTOM_NODE } from '../constants'
import { BlockEnum, NodeRunningStatus } from '../types'

let nodeIdCounter = 0
let edgeIdCounter = 0

export function resetFixtureCounters() {
  nodeIdCounter = 0
  edgeIdCounter = 0
}

export function createNode(
  overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {},
): Node {
  const id = overrides.id ?? `node-${++nodeIdCounter}`
  const { data: dataOverrides, ...rest } = overrides
  return {
    id,
    type: CUSTOM_NODE,
    position: { x: 0, y: 0 },
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    data: {
      title: `Node ${id}`,
      desc: '',
      type: BlockEnum.Code,
      _connectedSourceHandleIds: [],
      _connectedTargetHandleIds: [],
      ...dataOverrides,
    } as CommonNodeType,
    ...rest,
  } as Node
}

export function createStartNode(overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {}): Node {
  return createNode({
    ...overrides,
    data: { type: BlockEnum.Start, title: 'Start', desc: '', ...overrides.data },
  })
}

export function createTriggerNode(
  triggerType: BlockEnum.TriggerSchedule | BlockEnum.TriggerWebhook | BlockEnum.TriggerPlugin = BlockEnum.TriggerWebhook,
  overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {},
): Node {
  return createNode({
    ...overrides,
    data: { type: triggerType, title: `Trigger ${triggerType}`, desc: '', ...overrides.data },
  })
}

export function createIterationNode(overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {}): Node {
  return createNode({
    ...overrides,
    data: { type: BlockEnum.Iteration, title: 'Iteration', desc: '', ...overrides.data },
  })
}

export function createLoopNode(overrides: Omit<Partial<Node>, 'data'> & { data?: Partial<CommonNodeType> & Record<string, unknown> } = {}): Node {
  return createNode({
    ...overrides,
    data: { type: BlockEnum.Loop, title: 'Loop', desc: '', ...overrides.data },
  })
}

export function createEdge(overrides: Omit<Partial<Edge>, 'data'> & { data?: Partial<CommonEdgeType> & Record<string, unknown> } = {}): Edge {
  const { data: dataOverrides, ...rest } = overrides
  return {
    id: overrides.id ?? `edge-${overrides.source ?? 'src'}-${overrides.target ?? 'tgt'}-${++edgeIdCounter}`,
    source: 'source-node',
    target: 'target-node',
    data: {
      sourceType: BlockEnum.Start,
      targetType: BlockEnum.Code,
      ...dataOverrides,
    } as CommonEdgeType,
    ...rest,
  } as Edge
}

export function createLinearGraph(nodeCount: number): { nodes: Node[], edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (let i = 0; i < nodeCount; i++) {
    const type = i === 0 ? BlockEnum.Start : BlockEnum.Code
    nodes.push(createNode({
      id: `n${i}`,
      position: { x: i * 300, y: 0 },
      data: { type, title: `Node ${i}`, desc: '' },
    }))
    if (i > 0) {
      edges.push(createEdge({
        id: `e-n${i - 1}-n${i}`,
        source: `n${i - 1}`,
        target: `n${i}`,
        sourceHandle: 'source',
        targetHandle: 'target',
        data: {
          sourceType: i === 1 ? BlockEnum.Start : BlockEnum.Code,
          targetType: BlockEnum.Code,
        },
      }))
    }
  }
  return { nodes, edges }
}

export { BlockEnum, NodeRunningStatus }
