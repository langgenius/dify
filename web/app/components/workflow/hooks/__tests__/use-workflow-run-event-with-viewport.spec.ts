import type {
  HumanInputRequiredResponse,
  IterationStartedResponse,
  LoopStartedResponse,
  NodeStartedResponse,
} from '@/types/workflow'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { baseRunningData, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../constants'
import { NodeRunningStatus } from '../../types'
import { useWorkflowNodeHumanInputRequired } from '../use-workflow-run-event/use-workflow-node-human-input-required'
import { useWorkflowNodeIterationStarted } from '../use-workflow-run-event/use-workflow-node-iteration-started'
import { useWorkflowNodeLoopStarted } from '../use-workflow-run-event/use-workflow-node-loop-started'
import { useWorkflowNodeStarted } from '../use-workflow-run-event/use-workflow-node-started'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

function findNodeById(nodes: Array<{ id: string, data: Record<string, unknown> }>, id: string) {
  return nodes.find(n => n.id === id)!
}

const containerParams = { clientWidth: 1200, clientHeight: 800 }

describe('useWorkflowNodeStarted', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n0', position: { x: 0, y: 0 }, width: 200, height: 80, data: { _runningStatus: NodeRunningStatus.Succeeded } },
      { id: 'n1', position: { x: 100, y: 50 }, width: 200, height: 80, data: { _waitingRun: true } },
      { id: 'n2', position: { x: 400, y: 50 }, width: 200, height: 80, parentId: 'n1', data: { _waitingRun: true } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should push to tracing, set node running, and adjust viewport for root node', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowNodeStarted(
      { data: { node_id: 'n1' } } as NodeStartedResponse,
      containerParams,
    )

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(1)
    expect(tracing[0].status).toBe(NodeRunningStatus.Running)

    expect(rfState.setViewport).toHaveBeenCalledOnce()

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    const n1 = findNodeById(updatedNodes, 'n1')
    expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
    expect(n1.data._waitingRun).toBe(false)

    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })

  it('should not adjust viewport for child node (has parentId)', () => {
    const { result } = renderWorkflowHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowNodeStarted(
      { data: { node_id: 'n2' } } as NodeStartedResponse,
      containerParams,
    )

    expect(rfState.setViewport).not.toHaveBeenCalled()
  })

  it('should update existing tracing entry if node_id exists at non-zero index', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            { node_id: 'n0', status: NodeRunningStatus.Succeeded },
            { node_id: 'n1', status: NodeRunningStatus.Succeeded },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeStarted(
      { data: { node_id: 'n1' } } as NodeStartedResponse,
      containerParams,
    )

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(2)
    expect(tracing[1].status).toBe(NodeRunningStatus.Running)
  })
})

describe('useWorkflowNodeIterationStarted', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n0', position: { x: 0, y: 0 }, width: 200, height: 80, data: { _runningStatus: NodeRunningStatus.Succeeded } },
      { id: 'n1', position: { x: 100, y: 50 }, width: 200, height: 80, data: { _waitingRun: true } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should push to tracing, reset iterTimes, set viewport, and update node with _iterationLength', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeIterationStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 99,
      },
    })

    result.current.handleWorkflowNodeIterationStarted(
      { data: { node_id: 'n1', metadata: { iterator_length: 10 } } } as IterationStartedResponse,
      containerParams,
    )

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing[0].status).toBe(NodeRunningStatus.Running)

    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)
    expect(rfState.setViewport).toHaveBeenCalledOnce()

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    const n1 = findNodeById(updatedNodes, 'n1')
    expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
    expect(n1.data._iterationLength).toBe(10)
    expect(n1.data._waitingRun).toBe(false)

    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })
})

describe('useWorkflowNodeLoopStarted', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n0', position: { x: 0, y: 0 }, width: 200, height: 80, data: { _runningStatus: NodeRunningStatus.Succeeded } },
      { id: 'n1', position: { x: 100, y: 50 }, width: 200, height: 80, data: { _waitingRun: true } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should push to tracing, set viewport, and update node with _loopLength', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeLoopStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowNodeLoopStarted(
      { data: { node_id: 'n1', metadata: { loop_length: 5 } } } as LoopStartedResponse,
      containerParams,
    )

    expect(store.getState().workflowRunningData!.tracing![0].status).toBe(NodeRunningStatus.Running)
    expect(rfState.setViewport).toHaveBeenCalledOnce()

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    const n1 = findNodeById(updatedNodes, 'n1')
    expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
    expect(n1.data._loopLength).toBe(5)
    expect(n1.data._waitingRun).toBe(false)

    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })
})

describe('useWorkflowNodeHumanInputRequired', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } },
      { id: 'n2', position: { x: 300, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } },
    ]
  })

  it('should create humanInputFormDataList and set tracing/node to Paused', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputRequired(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputRequired({
      data: { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: 'content' },
    } as HumanInputRequiredResponse)

    const state = store.getState().workflowRunningData!
    expect(state.humanInputFormDataList).toHaveLength(1)
    expect(state.humanInputFormDataList![0].form_id).toBe('f1')
    expect(state.tracing![0].status).toBe(NodeRunningStatus.Paused)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(findNodeById(updatedNodes, 'n1').data._runningStatus).toBe(NodeRunningStatus.Paused)
  })

  it('should update existing form entry for same node_id', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputRequired(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1', status: NodeRunningStatus.Running }],
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'old', node_title: 'Node 1', form_content: 'old' },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputRequired({
      data: { node_id: 'n1', form_id: 'new', node_title: 'Node 1', form_content: 'new' },
    } as HumanInputRequiredResponse)

    const formList = store.getState().workflowRunningData!.humanInputFormDataList!
    expect(formList).toHaveLength(1)
    expect(formList[0].form_id).toBe('new')
  })

  it('should append new form entry for different node_id', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputRequired(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n2', status: NodeRunningStatus.Running }],
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputRequired({
      data: { node_id: 'n2', form_id: 'f2', node_title: 'Node 2', form_content: 'content2' },
    } as HumanInputRequiredResponse)

    expect(store.getState().workflowRunningData!.humanInputFormDataList).toHaveLength(2)
  })
})
