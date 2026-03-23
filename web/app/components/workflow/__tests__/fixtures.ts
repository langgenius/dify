import type { CommonEdgeType, CommonNodeType, Edge, Node, ToolWithProvider, WorkflowRunningData } from '../types'
import type { NodeTracing } from '@/types/workflow'
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

// ---------------------------------------------------------------------------
// Workflow-level factories
// ---------------------------------------------------------------------------

export function createWorkflowRunningData(
  overrides?: Partial<WorkflowRunningData>,
): WorkflowRunningData {
  return {
    task_id: 'task-test',
    result: {
      status: 'running',
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
      ...overrides?.result,
    },
    tracing: overrides?.tracing ?? [],
    ...overrides,
  }
}

export function createNodeTracing(
  overrides?: Partial<NodeTracing>,
): NodeTracing {
  const nodeId = overrides?.node_id ?? 'node-1'
  return {
    id: `trace-${nodeId}`,
    index: 0,
    predecessor_node_id: '',
    node_id: nodeId,
    node_type: BlockEnum.Code,
    title: 'Node',
    inputs: null,
    inputs_truncated: false,
    process_data: null,
    process_data_truncated: false,
    outputs_truncated: false,
    status: NodeRunningStatus.Running,
    elapsed_time: 0,
    metadata: { iterator_length: 0, iterator_index: 0, loop_length: 0, loop_index: 0 },
    created_at: 0,
    created_by: { id: 'user-1', name: 'Test', email: 'test@test.com' },
    finished_at: 0,
    ...overrides,
  }
}

export function createToolWithProvider(
  overrides?: Partial<ToolWithProvider>,
): ToolWithProvider {
  return {
    id: 'tool-provider-1',
    name: 'test-tool',
    author: 'test',
    description: { en_US: 'Test tool', zh_Hans: '测试工具' },
    icon: '/icon.svg',
    icon_dark: '/icon-dark.svg',
    label: { en_US: 'Test Tool', zh_Hans: '测试工具' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
    tools: [],
    meta: { version: '0.0.1' },
    plugin_id: 'plugin-1',
    ...overrides,
  }
}

export { BlockEnum, NodeRunningStatus }
