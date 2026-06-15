import type { CommonEdgeType, CommonNodeType, Edge, Node, WorkflowRunningData } from '../types'
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

export function createNodeDataFactory<T extends CommonNodeType & Record<string, unknown>>(defaults: T) {
  return (overrides: Partial<T> = {}): T => ({
    ...defaults,
    ...overrides,
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
