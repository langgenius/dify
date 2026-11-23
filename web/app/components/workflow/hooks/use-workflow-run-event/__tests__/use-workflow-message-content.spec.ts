import type { WorkflowFinishedResponse } from '@/types/workflow'
import { act } from '@testing-library/react'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowFailed } from '../use-workflow-failed'
import { useWorkflowFinished } from '../use-workflow-finished'
import { useWorkflowMessageContent } from '../use-workflow-message-content'
import { useWorkflowTextChunk } from '../use-workflow-text-chunk'
import { renderRunEventHook } from './test-helpers'

describe('workflow generative UI stream handlers', () => {
  it('merges streamed text chunks and OpenUI message_content events into ordered parts', () => {
    const { result, store } = renderWorkflowHook(
      () => ({
        ...useWorkflowTextChunk(),
        ...useWorkflowMessageContent(),
        ...useWorkflowFinished(),
      }),
      {
        initialStoreState: { workflowRunningData: baseRunningData() },
      },
    )

    act(() => {
      result.current.handleWorkflowTextChunk({
        event: 'text_chunk',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: { text: 'Summary.\n' },
      })
      result.current.handleWorkflowMessageContent({
        event: 'message_content',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: {
          id: 'ui-1',
          type: 'openui',
          status: 'streaming',
          sequence: 1,
          library_version: 'dify-ui-v1',
          form_state: {},
          source: 'root = Card("Q1")',
        },
      })
      result.current.handleWorkflowMessageContent({
        event: 'message_content',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: {
          id: 'ui-1',
          type: 'openui_delta',
          sequence: 2,
          base_sequence: 1,
          source_delta: '\n',
        },
      })
      result.current.handleWorkflowMessageContent({
        event: 'message_content',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: {
          id: 'ui-1',
          type: 'openui',
          status: 'completed',
          sequence: 3,
          library_version: 'dify-ui-v1',
          form_state: {},
          source: 'root = Card("Q1")\n',
        },
      })
      result.current.handleWorkflowTextChunk({
        event: 'text_chunk',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: { text: 'Done.' },
      })
    })

    const streamingState = store.getState().workflowRunningData!
    expect(streamingState.resultTabActive).toBe(true)
    expect(streamingState.parts?.map((part) => part.type)).toEqual(['text', 'openui', 'text'])
    expect(streamingState.parts?.[1]).toMatchObject({
      id: 'ui-1',
      status: 'completed',
      source: 'root = Card("Q1")\n',
    })

    act(() => {
      result.current.handleWorkflowFinished({
        data: {
          status: 'succeeded',
          outputs: { report: 'Summary.\nDone.' },
          parts: [
            { id: 't1', type: 'text', text: 'Summary.\n' },
            {
              id: 'ui-1',
              type: 'openui',
              status: 'completed',
              sequence: 3,
              library_version: 'dify-ui-v1',
              form_state: {},
              source: 'root = Card("Q1")\n',
            },
          ],
        },
      } as WorkflowFinishedResponse)
    })

    const finishedState = store.getState().workflowRunningData!
    expect(finishedState.resultTabActive).toBe(true)
    expect(finishedState.parts).toHaveLength(2)
  })

  it('marks streaming OpenUI parts as error when the workflow fails', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowFailed(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          parts: [
            {
              id: 'ui-1',
              type: 'openui',
              status: 'streaming',
              sequence: 1,
              library_version: 'dify-ui-v1',
              form_state: {},
              source: 'root = Card("Partial',
            },
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowFailed()
    })

    expect(store.getState().workflowRunningData?.parts?.[0]).toMatchObject({
      id: 'ui-1',
      status: 'error',
    })
  })
})
