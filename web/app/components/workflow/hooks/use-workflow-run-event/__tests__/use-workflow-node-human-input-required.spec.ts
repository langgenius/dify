import type { HumanInputFormData, HumanInputRequiredResponse } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeHumanInputRequired } from '../use-workflow-node-human-input-required'
import { getNodeRuntimeState, renderViewportHook } from './test-helpers'

const form = (nodeId: string, overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  node_id: nodeId,
  node_title: nodeId,
  form_id: `form-${nodeId}`,
  form_content: `Content for ${nodeId}`,
  inputs: [],
  actions: [],
  form_token: null,
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
  ...overrides,
})

it('pauses only the waiting node and replaces its form without losing other pending forms', async () => {
  const { result, store } = renderViewportHook(() => useWorkflowNodeHumanInputRequired(), {
    nodes: ['n1', 'n2'].map((id, index) =>
      createNode({
        id,
        position: { x: index * 300, y: 0 },
        data: { _runningStatus: NodeRunningStatus.Running },
      }),
    ),
    edges: [],
    initialStoreState: {
      workflowRunningData: baseRunningData({
        tracing: ['n1', 'n2'].map((node_id) => ({ node_id, status: NodeRunningStatus.Running })),
      }),
    },
  })
  const send = (data: HumanInputFormData) => {
    const event: HumanInputRequiredResponse = {
      task_id: 'task',
      workflow_run_id: 'run',
      event: 'human_input_required',
      data,
    }
    act(() => result.current.handleWorkflowNodeHumanInputRequired(event))
  }
  const first = form('n1')
  send(first)
  expect(store.getState().workflowRunningData!.humanInputFormDataList).toEqual([first])
  expect(store.getState().workflowRunningData!.tracing).toMatchObject([
    { node_id: 'n1', status: NodeRunningStatus.Paused },
    { node_id: 'n2', status: NodeRunningStatus.Running },
  ])
  await waitFor(() => {
    expect(
      getNodeRuntimeState(result.current.nodes.find((node) => node.id === 'n1'))._runningStatus,
    ).toBe(NodeRunningStatus.Paused)
  })
  expect(
    getNodeRuntimeState(result.current.nodes.find((node) => node.id === 'n2'))._runningStatus,
  ).toBe(NodeRunningStatus.Running)
  const second = form('n2')
  send(second)
  expect(store.getState().workflowRunningData!.humanInputFormDataList).toEqual([first, second])
  const updated = form('n1', { form_id: 'replacement', form_content: 'Updated instructions' })
  send(updated)
  expect(store.getState().workflowRunningData!.humanInputFormDataList).toEqual([updated, second])
})
