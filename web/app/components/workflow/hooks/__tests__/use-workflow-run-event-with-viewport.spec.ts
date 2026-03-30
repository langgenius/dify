import type {
  HumanInputRequiredResponse,
  IterationStartedResponse,
  LoopStartedResponse,
  NodeStartedResponse,
} from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { useEdges, useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { baseRunningData, renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../constants'
import { NodeRunningStatus } from '../../types'
import { useWorkflowNodeHumanInputRequired } from '../use-workflow-run-event/use-workflow-node-human-input-required'
import { useWorkflowNodeIterationStarted } from '../use-workflow-run-event/use-workflow-node-iteration-started'
import { useWorkflowNodeLoopStarted } from '../use-workflow-run-event/use-workflow-node-loop-started'
import { useWorkflowNodeStarted } from '../use-workflow-run-event/use-workflow-node-started'

type NodeRuntimeState = {
  _waitingRun?: boolean
  _runningStatus?: NodeRunningStatus
  _iterationLength?: number
  _loopLength?: number
}

type EdgeRuntimeState = {
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

const containerParams = { clientWidth: 1200, clientHeight: 800 }

function createViewportNodes() {
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

function renderViewportHook<T extends Record<string, unknown>>(
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

describe('useWorkflowNodeStarted', () => {
  it('should push to tracing, set node running, and adjust viewport for root node', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(
        { data: { node_id: 'n1' } } as NodeStartedResponse,
        containerParams,
      )
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(1)
    expect(tracing[0].status).toBe(NodeRunningStatus.Running)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })

  it('should not adjust viewport for child node (has parentId)', async () => {
    const { result } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(
        { data: { node_id: 'n2' } } as NodeStartedResponse,
        containerParams,
      )
    })

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(0)
      expect(transform[1]).toBe(0)
      expect(transform[2]).toBe(1)
      expect(getNodeRuntimeState(result.current.nodes.find(item => item.id === 'n2'))._runningStatus).toBe(NodeRunningStatus.Running)
    })
  })

  it('should update existing tracing entry if node_id exists at non-zero index', () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            { node_id: 'n0', status: NodeRunningStatus.Succeeded },
            { node_id: 'n1', status: NodeRunningStatus.Succeeded },
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(
        { data: { node_id: 'n1' } } as NodeStartedResponse,
        containerParams,
      )
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(2)
    expect(tracing[1].status).toBe(NodeRunningStatus.Running)
  })
})

describe('useWorkflowNodeIterationStarted', () => {
  it('should push to tracing, reset iterTimes, set viewport, and update node with _iterationLength', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeIterationStarted(), {
      nodes: createViewportNodes().slice(0, 2),
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 99,
      },
    })

    act(() => {
      result.current.handleWorkflowNodeIterationStarted(
        { data: { node_id: 'n1', metadata: { iterator_length: 10 } } } as IterationStartedResponse,
        containerParams,
      )
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing[0].status).toBe(NodeRunningStatus.Running)
    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._iterationLength).toBe(10)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })
})

describe('useWorkflowNodeLoopStarted', () => {
  it('should push to tracing, set viewport, and update node with _loopLength', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeLoopStarted(), {
      nodes: createViewportNodes().slice(0, 2),
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeLoopStarted(
        { data: { node_id: 'n1', metadata: { loop_length: 5 } } } as LoopStartedResponse,
        containerParams,
      )
    })

    expect(store.getState().workflowRunningData!.tracing![0].status).toBe(NodeRunningStatus.Running)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._loopLength).toBe(5)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })
})

describe('useWorkflowNodeHumanInputRequired', () => {
  it('should create humanInputFormDataList and set tracing/node to Paused', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeHumanInputRequired(), {
      nodes: [
        createNode({ id: 'n1', data: { _runningStatus: NodeRunningStatus.Running } }),
        createNode({ id: 'n2', position: { x: 300, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } }),
      ],
      edges: [],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeHumanInputRequired({
        data: { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: 'content' },
      } as HumanInputRequiredResponse)
    })

    const state = store.getState().workflowRunningData!
    expect(state.humanInputFormDataList).toHaveLength(1)
    expect(state.humanInputFormDataList![0].form_id).toBe('f1')
    expect(state.tracing![0].status).toBe(NodeRunningStatus.Paused)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes.find(item => item.id === 'n1'))._runningStatus).toBe(NodeRunningStatus.Paused)
    })
  })

  it('should update existing form entry for same node_id', () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeHumanInputRequired(), {
      nodes: [
        createNode({ id: 'n1', data: { _runningStatus: NodeRunningStatus.Running } }),
        createNode({ id: 'n2', position: { x: 300, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } }),
      ],
      edges: [],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1', status: NodeRunningStatus.Running }],
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'old', node_title: 'Node 1', form_content: 'old' },
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeHumanInputRequired({
        data: { node_id: 'n1', form_id: 'new', node_title: 'Node 1', form_content: 'new' },
      } as HumanInputRequiredResponse)
    })

    const formList = store.getState().workflowRunningData!.humanInputFormDataList!
    expect(formList).toHaveLength(1)
    expect(formList[0].form_id).toBe('new')
  })

  it('should append new form entry for different node_id', () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeHumanInputRequired(), {
      nodes: [
        createNode({ id: 'n1', data: { _runningStatus: NodeRunningStatus.Running } }),
        createNode({ id: 'n2', position: { x: 300, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } }),
      ],
      edges: [],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n2', status: NodeRunningStatus.Running }],
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeHumanInputRequired({
        data: { node_id: 'n2', form_id: 'f2', node_title: 'Node 2', form_content: 'content2' },
      } as HumanInputRequiredResponse)
    })

    expect(store.getState().workflowRunningData!.humanInputFormDataList).toHaveLength(2)
  })
})
