import type { HumanInputRequiredResponse } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeHumanInputRequired } from '../use-workflow-node-human-input-required'
import {
  getNodeRuntimeState,
  renderViewportHook,
} from './test-helpers'

describe('useWorkflowNodeHumanInputRequired', () => {
  it('creates humanInputFormDataList and sets tracing and node to Paused', async () => {
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
    expect(state.humanInputFormDataList![0]!.form_id).toBe('f1')
    expect(state.tracing![0]!.status).toBe(NodeRunningStatus.Paused)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes.find(item => item.id === 'n1'))._runningStatus).toBe(NodeRunningStatus.Paused)
    })
  })

  it('updates existing form entry for the same node_id', () => {
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
    expect(formList[0]!.form_id).toBe('new')
  })

  it('appends a new form entry for a different node_id', () => {
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
