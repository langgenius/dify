import type { HumanInputFormData } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import { useWorkflowNodeHumanInputFormFilled } from '../use-workflow-node-human-input-form-filled'
import { useWorkflowNodeHumanInputFormTimeout } from '../use-workflow-node-human-input-form-timeout'
import { useWorkflowNodeHumanInputRequired } from '../use-workflow-node-human-input-required'
import { getNodeRuntimeState, renderViewportHook } from './test-helpers'

const createForm = (form_id: string): HumanInputFormData => ({
  form_id,
  node_id: 'tool',
  node_title: 'Workflow Tool',
  form_content: `Approval ${form_id}`,
  inputs: [],
  actions: [],
  form_token: `token-${form_id}`,
  display_in_ui: true,
  expiration_time: 100,
  resolved_default_values: {},
})

it('keeps forms independent while highlighting their shared Tool node', async () => {
  const { result, store } = renderViewportHook(
    () => ({
      ...useWorkflowNodeHumanInputRequired(),
      ...useWorkflowNodeHumanInputFormFilled(),
      ...useWorkflowNodeHumanInputFormTimeout(),
    }),
    {
      nodes: [createNode({ id: 'tool', data: { type: BlockEnum.Tool } })],
      edges: [],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'tool', status: NodeRunningStatus.Running }],
        }),
      },
    },
  )
  const envelope = { event: 'human_input_required', workflow_run_id: 'run', task_id: 'task' }
  const first = createForm('first')
  const second = createForm('second')

  act(() => {
    result.current.handleWorkflowNodeHumanInputRequired({ ...envelope, data: first })
    result.current.handleWorkflowNodeHumanInputRequired({ ...envelope, data: second })
    result.current.handleWorkflowNodeHumanInputRequired({
      ...envelope,
      data: { ...second, form_token: 'refreshed' },
    })
  })

  expect(store.getState().workflowRunningData!.humanInputFormDataList).toEqual([
    first,
    { ...second, form_token: 'refreshed' },
  ])
  expect(store.getState().workflowRunningData!.tracing![0]!.status).toBe(NodeRunningStatus.Paused)
  await waitFor(() => {
    expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(
      NodeRunningStatus.Paused,
    )
  })

  act(() => {
    result.current.handleWorkflowNodeHumanInputFormTimeout({
      ...envelope,
      data: { ...second, expiration_time: 200 },
    })
  })
  expect(
    store
      .getState()
      .workflowRunningData!.humanInputFormDataList?.map((form) => form.expiration_time),
  ).toEqual([100, 200])

  const filled = {
    form_id: 'second',
    node_id: 'tool',
    node_title: 'Tool',
    rendered_content: 'Approved',
    action_id: 'approve',
    action_text: 'Approve',
  }
  act(() => {
    result.current.handleWorkflowNodeHumanInputFormFilled({ ...envelope, data: filled })
    result.current.handleWorkflowNodeHumanInputFormFilled({
      ...envelope,
      data: { ...filled, rendered_content: 'Replayed approval' },
    })
    result.current.handleWorkflowNodeHumanInputFormTimeout({
      ...envelope,
      data: { ...second, expiration_time: 300 },
    })
  })
  expect(store.getState().workflowRunningData!.humanInputFormDataList).toEqual([first])
  expect(store.getState().workflowRunningData!.humanInputFilledFormDataList).toEqual([
    { ...filled, rendered_content: 'Replayed approval' },
  ])
})
