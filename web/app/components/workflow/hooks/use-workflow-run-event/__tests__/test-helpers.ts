import type { WorkflowRunningData } from '../../../types'
import type {
  IterationFinishedResponse,
  IterationNextResponse,
  LoopFinishedResponse,
  LoopNextResponse,
  NodeFinishedResponse,
  NodeStartedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { useEdges, useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../../types'

type NodeRuntimeState = {
  _waitingRun?: boolean
  _runningStatus?: NodeRunningStatus
  _retryIndex?: number
  _iterationIndex?: number
  _iterationLength?: number
  _loopIndex?: number
  _loopLength?: number
  _runningBranchId?: string
}

type EdgeRuntimeState = {
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

export const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

export const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

function createRunNodes() {
  return [
    createNode({
      id: 'n1',
      width: 200,
      height: 80,
      data: { _waitingRun: false },
    }),
  ]
}

function createRunEdges() {
  return [
    createEdge({
      id: 'e1',
      source: 'n0',
      target: 'n1',
      data: {},
    }),
  ]
}

export function createViewportNodes() {
  return [
    createNode({
      id: 'n0',
      width: 200,
      height: 80,
      data: { _runningStatus: NodeRunningStatus.Succeeded },
    }),
    createNode({
      id: 'n1',
      position: { x: 100, y: 50 },
      width: 200,
      height: 80,
      data: { _waitingRun: true },
    }),
    createNode({
      id: 'n2',
      position: { x: 400, y: 50 },
      width: 200,
      height: 80,
      parentId: 'n1',
      data: { _waitingRun: true },
    }),
  ]
}

function createViewportEdges() {
  return [
    createEdge({
      id: 'e1',
      source: 'n0',
      target: 'n1',
      sourceHandle: 'source',
      data: {},
    }),
  ]
}

export const containerParams = { clientWidth: 1200, clientHeight: 800 }

export function renderRunEventHook<T extends Record<string, unknown>>(
  useHook: () => T,
  options?: {
    nodes?: ReturnType<typeof createRunNodes>
    edges?: ReturnType<typeof createRunEdges>
    initialStoreState?: Record<string, unknown>
  },
) {
  const { nodes = createRunNodes(), edges = createRunEdges(), initialStoreState } = options ?? {}

  return renderWorkflowFlowHook(() => ({
    ...useHook(),
    nodes: useNodes(),
    edges: useEdges(),
  }), {
    nodes,
    edges,
    reactFlowProps: { fitView: false },
    initialStoreState,
  })
}

export function renderViewportHook<T extends Record<string, unknown>>(
  useHook: () => T,
  options?: {
    nodes?: ReturnType<typeof createViewportNodes>
    edges?: ReturnType<typeof createViewportEdges>
    initialStoreState?: Record<string, unknown>
  },
) {
  const {
    nodes = createViewportNodes(),
    edges = createViewportEdges(),
    initialStoreState,
  } = options ?? {}

  return renderWorkflowFlowHook(() => ({
    ...useHook(),
    nodes: useNodes(),
    edges: useEdges(),
    reactFlowStore: useStoreApi(),
  }), {
    nodes,
    edges,
    reactFlowProps: { fitView: false },
    initialStoreState,
  })
}

export const createStartedResponse = (overrides: Partial<WorkflowStartedResponse> = {}): WorkflowStartedResponse => ({
  task_id: 'task-2',
  data: { id: 'run-1', workflow_id: 'wf-1', created_at: 1000 },
  ...overrides,
} as WorkflowStartedResponse)

export const createNodeFinishedResponse = (overrides: Partial<NodeFinishedResponse> = {}): NodeFinishedResponse => ({
  data: { id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
  ...overrides,
} as NodeFinishedResponse)

export const createIterationNextResponse = (overrides: Partial<IterationNextResponse> = {}): IterationNextResponse => ({
  data: { node_id: 'n1' },
  ...overrides,
} as IterationNextResponse)

export const createIterationFinishedResponse = (overrides: Partial<IterationFinishedResponse> = {}): IterationFinishedResponse => ({
  data: { id: 'iter-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
  ...overrides,
} as IterationFinishedResponse)

export const createLoopNextResponse = (overrides: Partial<LoopNextResponse> = {}): LoopNextResponse => ({
  data: { node_id: 'n1', index: 5 },
  ...overrides,
} as LoopNextResponse)

export const createLoopFinishedResponse = (overrides: Partial<LoopFinishedResponse> = {}): LoopFinishedResponse => ({
  data: { id: 'loop-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
  ...overrides,
} as LoopFinishedResponse)

export const createNodeStartedResponse = (overrides: Partial<NodeStartedResponse> = {}): NodeStartedResponse => ({
  data: { node_id: 'n1' },
  ...overrides,
} as NodeStartedResponse)

export const pausedRunningData = (): WorkflowRunningData['result'] => ({ status: WorkflowRunningStatus.Paused } as WorkflowRunningData['result'])
