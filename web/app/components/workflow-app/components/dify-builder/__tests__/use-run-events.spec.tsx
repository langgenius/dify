import type {
  WorkflowRunDetailResponse,
  WorkflowRunNodeExecutionListResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { CanvasEventData, ConversationItem } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { useDifyBuilderRunEvents } from '../provider/use-run-events'
import { difyBuilderErrorAtom } from '../store'
import {
  nodeFinished,
  nodeStarted,
  runFinished,
  runStarted,
  workflowEvent,
} from './workflow-fixtures'

const mocks = vi.hoisted(() => ({
  detail: vi.fn<(input: unknown) => Promise<WorkflowRunDetailResponse>>(),
  executions: vi.fn<(input: unknown) => Promise<WorkflowRunNodeExecutionListResponse>>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const run = actual.consoleQuery.apps.byAppId.workflowRuns.byRunId
  return {
    ...actual,
    consoleQuery: {
      apps: {
        byAppId: {
          workflowRuns: {
            byRunId: {
              get: {
                queryOptions: (options: Parameters<typeof run.get.queryOptions>[0]) => ({
                  ...run.get.queryOptions(options),
                  queryFn: () => mocks.detail(options?.input),
                }),
              },
              nodeExecutions: {
                get: {
                  queryOptions: (
                    options: Parameters<typeof run.nodeExecutions.get.queryOptions>[0],
                  ) => ({
                    ...run.nodeExecutions.get.queryOptions(options),
                    queryFn: () => mocks.executions(options?.input),
                  }),
                },
              },
            },
          },
        },
      },
    },
  }
})

const resultCard = {
  kind: 'test_result',
  seq: 0,
  at_version: 2,
  payload: {
    status: 'succeeded',
    dify_run_id: 'dify-run',
  },
} satisfies ConversationItem

const canvasEvent = (event: CanvasEventData['event'], revision = 1): CanvasEventData => ({
  session_id: 'session-1',
  operation_id: 'op',
  at_version: 2,
  revision,
  event,
})

const setup = () => {
  const store = createStore()
  const workflow = createWorkflowStore({})
  const QueryProvider = createQueryClientWrapper(createConsoleQueryClient())
  const hook = renderHook(
    () => ({ events: useDifyBuilderRunEvents('app-1'), canvas: useStoreApi() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryProvider>
          <Provider store={store}>
            <WorkflowContext value={workflow}>
              <ReactFlowProvider>{children}</ReactFlowProvider>
            </WorkflowContext>
          </Provider>
        </QueryProvider>
      ),
    },
  )
  const nodes: Node[] = ['start', 'answer'].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    data: { title: id, type: BlockEnum.Code, desc: '' },
  }))
  act(() => {
    hook.result.current.canvas.getState().setNodes(nodes)
    hook.result.current.canvas
      .getState()
      .setEdges([{ id: 'edge', source: 'start', target: 'answer' }])
  })
  const nodeStatus = () =>
    (hook.result.current.canvas.getState().getNodes() as Node[]).find(
      (node) => node.id === 'answer',
    )?.data._runningStatus
  return { ...hook, store, workflow, nodeStatus }
}

describe('Builder run event handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.detail.mockResolvedValue({
      id: 'dify-run',
      status: 'succeeded',
      graph: {},
      inputs: {},
      outputs: { result: '42' },
    })
    mocks.executions.mockResolvedValue({
      data: [
        { id: 'exec-1', index: 1, node_id: 'start', status: 'succeeded' },
        {
          id: 'exec-2',
          index: 2,
          node_id: 'answer',
          predecessor_node_id: 'start',
          status: 'succeeded',
        },
      ],
    })
  })

  it('paints the first node synchronously and keeps unknown results neutral across later canvas refreshes', () => {
    const { result, workflow, nodeStatus } = setup()
    act(() => {
      result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
      result.current.events.onWorkflowEvent(workflowEvent(nodeStarted()))
    })
    expect(nodeStatus()).toBe('running')
    expect(workflow.getState().workflowRunningData?.result).toMatchObject({
      id: 'dify-run',
      status: 'running',
    })
    act(() => result.current.events.finishCommand())
    expect(nodeStatus()).toBeUndefined()
    expect(workflow.getState().workflowRunningData?.result.status).toBe('unknown')
    act(() => result.current.events.onCanvasRefreshed())
    expect(nodeStatus()).toBeUndefined()
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it('handles the terminal run even when another canvas event immediately follows', async () => {
    const { result, workflow, nodeStatus } = setup()
    act(() => {
      result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
      result.current.events.onWorkflowEvent(workflowEvent(nodeStarted()))
      result.current.events.onWorkflowEvent(workflowEvent(nodeFinished()))
      result.current.events.onWorkflowEvent(workflowEvent(runFinished()))
      result.current.events.restoreRun('session-1', [resultCard])
      result.current.events.onCanvasEvent(canvasEvent('mark_test_success', 2))
      result.current.events.onCanvasEvent(canvasEvent('mark_review_ready', 3))
      result.current.events.finishCommand()
    })
    expect(workflow.getState().workflowRunningData?.result.status).toBe('succeeded')
    await waitFor(() => expect(nodeStatus()).toBe('succeeded'))
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.executions).not.toHaveBeenCalled()
    expect(workflow.getState().workflowRunningData?.tracing?.[0]).toMatchObject(nodeFinished().data)
    expect(workflow.getState().workflowRunningData?.resultText).toBe('42')
  })

  it('restores a card using the Dify ID and explicitly reapplies it after graph replacement', async () => {
    const { result, workflow, nodeStatus } = setup()
    act(() => result.current.events.restoreRun('session-1', [resultCard]))
    await waitFor(() => expect(nodeStatus()).toBe('succeeded'))
    expect(mocks.executions).toHaveBeenCalledWith({
      params: { app_id: 'app-1', run_id: 'dify-run' },
    })
    expect(workflow.getState().workflowRunningData?.result.outputs).toBe('{"result":"42"}')
    act(() =>
      result.current.canvas.getState().setNodes([
        {
          id: 'answer',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Code, title: 'Answer', desc: '' },
        },
      ]),
    )
    expect(nodeStatus()).toBeUndefined()
    act(() => result.current.events.onCanvasRefreshed())
    expect(nodeStatus()).toBe('succeeded')
    act(() => result.current.events.reset())
    expect(nodeStatus()).toBeUndefined()
    expect(workflow.getState().workflowRunningData).toBeUndefined()
  })

  it('recovers from a dropped terminal event when the result card is committed at the same version', async () => {
    const { result, nodeStatus, workflow } = setup()
    act(() => {
      result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
      result.current.events.onWorkflowEvent(workflowEvent(nodeStarted()))
      result.current.events.restoreRun('session-1', [resultCard])
      result.current.events.finishCommand()
    })
    await waitFor(() => expect(nodeStatus()).toBe('succeeded'))
    expect(workflow.getState().workflowRunningData?.result.status).toBe('succeeded')
  })

  it('restores missed node events after reconnect even when the terminal event arrives', async () => {
    const { result, workflow } = setup()
    act(() => {
      result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
      result.current.events.onStreamInterrupted()
      result.current.events.onWorkflowEvent(workflowEvent(runFinished()))
      result.current.events.restoreRun('session-1', [resultCard])
    })
    await waitFor(() => expect(workflow.getState().workflowRunningData?.tracing).toHaveLength(2))
    expect(mocks.detail).toHaveBeenCalledOnce()
    expect(mocks.executions).toHaveBeenCalledOnce()
  })

  it('shows a new run launch error even if a previous run finished', () => {
    const { result, workflow } = setup()
    act(() => {
      result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
      result.current.events.onWorkflowEvent(workflowEvent(runFinished()))
      result.current.events.onWorkflowEvent(
        workflowEvent(
          {
            event: 'error',
            workflow_run_id: 'next-run',
            code: 'invalid_param',
            status: 400,
            message: 'Invalid input',
          },
          { at_version: 3 },
        ),
      )
      result.current.events.finishCommand()
    })
    expect(workflow.getState().workflowRunningData?.result).toMatchObject({
      id: 'next-run',
      status: 'failed',
      error: 'Invalid input',
    })
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it('keeps distinct native agent log IDs and updates the matching log', () => {
    const { result, workflow } = setup()
    const log = {
      task_id: 'task-1',
      event: 'agent_log' as const,
      data: {
        id: 'log-1',
        node_id: 'answer',
        node_execution_id: 'exec-1',
        label: 'Tool',
        status: 'started',
        data: { input: 'query' },
      },
    }
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent(runStarted()))
      send(workflowEvent(nodeStarted()))
      send(workflowEvent(log))
      send(workflowEvent({ ...log, data: { ...log.data, id: 'log-2' } }))
      send(
        workflowEvent({
          ...log,
          data: { ...log.data, status: 'success', data: { output: 'answer' } },
        }),
      )
    })
    expect(
      workflow.getState().workflowRunningData?.tracing?.[0]?.execution_metadata?.agent_log,
    ).toEqual([
      { ...log.data, message_id: 'log-1', status: 'success', data: { output: 'answer' } },
      { ...log.data, id: 'log-2', message_id: 'log-2' },
    ])
  })

  it('handles native Chatflow messages without run IDs through the shared text callbacks', () => {
    const { result, workflow } = setup()
    const message = {
      event: 'message' as const,
      task_id: 'task-1',
      id: 'message-1',
      message_id: 'message-1',
      conversation_id: 'conversation-1',
      answer: 'hello',
      from_variable_selector: ['answer', 'text'],
    }
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent(runStarted()))
      send(workflowEvent(message))
      send(workflowEvent({ ...message, answer: ' world' }))
    })
    expect(workflow.getState().workflowRunningData?.resultText).toBe('hello world')
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(
        workflowEvent({
          event: 'message_replace',
          task_id: 'task-1',
          answer: 'replacement',
          reason: 'moderation',
        }),
      )
      send(
        workflowEvent({
          event: 'reasoning_chunk',
          task_id: 'task-1',
          data: { reasoning: 'thinking', is_final: true },
        }),
      )
    })
    const data = workflow.getState().workflowRunningData
    expect(data?.resultText).toBe('replacement')
    expect(data?.reasoningFinished).toBe(true)
    expect(data?.result).toMatchObject({ id: 'dify-run', status: 'running' })
    act(() => {
      result.current.events.onWorkflowEvent(
        workflowEvent({
          event: 'error',
          code: 'invalid_param',
          status: 400,
          message: 'native failure',
        }),
      )
      result.current.events.finishCommand()
    })
    expect(workflow.getState().workflowRunningData?.result).toMatchObject({
      id: 'dify-run',
      status: 'failed',
      error: 'native failure',
    })
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'handles a Chatflow error without a run ID (previous run: %s)',
    (previousRun) => {
      const { result, workflow } = setup()
      act(() => {
        const send = result.current.events.onWorkflowEvent
        if (previousRun) {
          send(workflowEvent(runStarted()))
          send(workflowEvent(runFinished()))
        }
        send(
          workflowEvent(
            {
              event: 'error',
              code: 'invalid_param',
              status: 400,
              message: 'Invalid input',
            },
            { at_version: 3 },
          ),
        )
        result.current.events.finishCommand()
      })
      expect(workflow.getState().workflowRunningData?.result).toMatchObject({
        id: '',
        status: 'failed',
        error: 'Invalid input',
      })
      expect(mocks.detail).not.toHaveBeenCalled()
    },
  )

  it('handles human-input timeout and submission while preserving a resumed run trace', () => {
    const { result, workflow } = setup()
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent(runStarted()))
      send(workflowEvent(nodeStarted()))
      send(
        workflowEvent({
          ...runStarted(),
          event: 'human_input_required',
          data: {
            node_id: 'answer',
            node_title: 'Approval',
            form_id: 'form-1',
            form_content: 'Approve?',
            inputs: [],
            actions: [],
            expiration_time: 999,
          },
        }),
      )
      send(
        workflowEvent({
          ...runStarted(),
          event: 'human_input_form_timeout',
          data: {
            node_id: 'answer',
            node_title: 'Approval',
            expiration_time: 1,
          },
        }),
      )
    })
    expect(
      workflow.getState().workflowRunningData?.humanInputFormDataList?.[0]?.expiration_time,
    ).toBe(1)
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(
        workflowEvent({
          ...runStarted(),
          event: 'workflow_paused',
          data: {
            workflow_run_id: 'dify-run',
            status: 'paused',
            paused_nodes: ['answer'],
            reasons: [],
            outputs: {},
            created_at: 1,
            elapsed_time: 1,
            total_steps: 1,
            total_tokens: 0,
          },
        }),
      )
      send(workflowEvent(runStarted(), { at_version: 3 }))
      send(
        workflowEvent({
          ...runStarted(),
          event: 'human_input_form_filled',
          data: {
            node_id: 'answer',
            node_title: 'Approval',
            rendered_content: 'Approved',
            action_id: 'approve',
            action_text: 'Approve',
            submitted_data: { comment: 'Proceed' },
          },
        }),
      )
    })
    const data = workflow.getState().workflowRunningData
    expect(data?.tracing).toHaveLength(1)
    expect(data?.result.status).toBe('running')
    expect(data?.humanInputFormDataList).toEqual([])
    expect(data?.humanInputFilledFormDataList?.[0]?.submitted_data).toEqual({ comment: 'Proceed' })
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it.each(['failed', 'partial-succeeded', 'stopped'] as const)(
    'preserves the native %s result through Builder markers and result cards',
    (status) => {
      const { result, workflow } = setup()
      act(() => {
        result.current.events.onWorkflowEvent(workflowEvent(runStarted()))
        result.current.events.onWorkflowEvent(workflowEvent(runFinished(status)))
        result.current.events.onCanvasEvent(canvasEvent('mark_test_error'))
        result.current.events.restoreRun('session-1', [
          { ...resultCard, payload: { ...resultCard.payload, status: 'failed' } },
        ])
        result.current.events.finishCommand()
      })
      expect(workflow.getState().workflowRunningData?.result.status).toBe(status)
      expect(mocks.detail).not.toHaveBeenCalled()
    },
  )

  it('handles streaming text, reasoning, retries and the native error', () => {
    const { result, workflow } = setup()
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent(runStarted()))
      send(workflowEvent(nodeStarted()))
      send(workflowEvent({ ...runStarted(), event: 'text_chunk', data: { text: 'hello' } }))
      send(workflowEvent({ ...runStarted(), event: 'text_chunk', data: { text: ' world' } }))
    })
    expect(workflow.getState().workflowRunningData?.resultText).toBe('hello world')
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent({ ...runStarted(), event: 'text_replace', data: { text: 'replacement' } }))
      send(
        workflowEvent({
          ...runStarted(),
          event: 'reasoning_chunk',
          data: { reasoning: 'thinking', node_id: 'answer', is_final: true },
        }),
      )
      send(
        workflowEvent({
          ...nodeFinished(),
          event: 'node_retry',
          data: { ...nodeFinished().data, retry_index: 1, status: 'retry' },
        }),
      )
      send(
        workflowEvent({
          event: 'error',
          workflow_run_id: 'dify-run',
          code: 'invalid_param',
          status: 400,
          message: 'native failure',
        }),
      )
      result.current.events.finishCommand()
    })
    const data = workflow.getState().workflowRunningData
    expect(data?.resultText).toBe('replacement')
    expect(data?.reasoningFinished).toBe(true)
    expect(data?.tracing?.at(-1)?.retry_index).toBe(1)
    expect(data?.result).toMatchObject({ status: 'failed', error: 'native failure' })
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it.each(['iteration', 'loop'] as const)(
    'dispatches %s lifecycle through the shared handlers',
    (kind) => {
      const { result, workflow, nodeStatus } = setup()
      const startData = {
        ...nodeStarted().data,
        inputs: {},
        metadata: { iterator_length: 2, loop_length: 2 },
      }
      const endData = { ...nodeFinished().data, execution_metadata: {}, steps: 2, total_tokens: 7 }
      act(() => {
        const send = result.current.events.onWorkflowEvent
        send(workflowEvent(runStarted()))
        send(
          workflowEvent({
            ...runStarted(),
            event: kind === 'iteration' ? 'iteration_started' : 'loop_started',
            data: startData,
          }),
        )
        send(
          workflowEvent({
            ...runStarted(),
            event: kind === 'iteration' ? 'iteration_next' : 'loop_next',
            data: { ...startData, index: 1 },
          }),
        )
        send(
          workflowEvent({
            ...runStarted(),
            event: kind === 'iteration' ? 'iteration_completed' : 'loop_completed',
            data: endData,
          }),
        )
      })
      expect(nodeStatus()).toBe('succeeded')
      expect(workflow.getState().workflowRunningData?.tracing?.[0]).toMatchObject(endData)
      expect(mocks.detail).not.toHaveBeenCalled()
    },
  )

  it('retains a human-input pause instead of projecting the Builder validation failure', () => {
    const { result, workflow, nodeStatus } = setup()
    act(() => {
      const send = result.current.events.onWorkflowEvent
      send(workflowEvent(runStarted()))
      send(workflowEvent(nodeStarted()))
      send(
        workflowEvent({
          ...runStarted(),
          event: 'human_input_required',
          data: {
            node_id: 'answer',
            node_title: 'Approval',
            form_id: 'form-1',
            form_content: 'Approve?',
            inputs: [],
            actions: [],
            expiration_time: 999,
          },
        }),
      )
      send(
        workflowEvent({
          ...runStarted(),
          event: 'workflow_paused',
          data: {
            workflow_run_id: 'dify-run',
            status: 'paused',
            paused_nodes: ['answer'],
            reasons: [],
            outputs: {},
            created_at: 1,
            elapsed_time: 1,
            total_steps: 1,
            total_tokens: 0,
          },
        }),
      )
      result.current.events.onCanvasEvent(canvasEvent('mark_test_error'))
      result.current.events.restoreRun('session-1', [resultCard])
      result.current.events.finishCommand()
      result.current.events.onCanvasRefreshed()
    })
    expect(workflow.getState().workflowRunningData?.result.status).toBe('paused')
    expect(workflow.getState().workflowRunningData?.humanInputFormDataList?.[0]?.form_id).toBe(
      'form-1',
    )
    expect(nodeStatus()).toBe('paused')
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it('ignores internal Builder IDs and cards invalidated by a revert', () => {
    const { result, nodeStatus } = setup()
    act(() => {
      result.current.events.restoreRun('session-1', [
        { ...resultCard, payload: { ...resultCard.payload, dify_run_id: '' } },
      ])
      result.current.events.restoreRun('session-1', [
        resultCard,
        {
          kind: 'assistant_turn',
          seq: 1,
          at_version: 2,
          payload: {
            turn_id: 'turn',
            stage_id: 'build.test_and_repair',
            reply_text: '',
            execution: { status: 'completed' },
            cards: ['test_result'],
            card_state: 'invalidated',
          },
        },
      ])
    })
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(nodeStatus()).toBeUndefined()
  })

  it.each(['detail', 'executions'] as const)(
    'reports a failed %s restore and retries the same run successfully',
    async (request) => {
      mocks[request].mockRejectedValueOnce(new Error('Connection lost'))
      const { result, store, workflow, nodeStatus } = setup()
      act(() => result.current.events.restoreRun('session-1', [resultCard]))
      await waitFor(() => expect(store.get(difyBuilderErrorAtom)).toBe('Connection lost'))

      act(() => result.current.events.restoreRun('session-1', [resultCard]))

      await waitFor(() => expect(nodeStatus()).toBe('succeeded'))
      expect(workflow.getState().workflowRunningData?.result.status).toBe('succeeded')
      expect(mocks[request]).toHaveBeenCalledTimes(2)
      expect(store.get(difyBuilderErrorAtom)).toBe('')
      act(() => result.current.events.restoreRun('session-1', [resultCard]))
      expect(mocks[request]).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['running', 'paused'])(
    'refreshes a restored %s run when it later finishes',
    async (status) => {
      mocks.detail.mockResolvedValueOnce({
        id: 'dify-run',
        status,
        graph: {},
        inputs: {},
        outputs: {},
      })
      const { result, workflow } = setup()
      act(() => result.current.events.restoreRun('session-1', [resultCard]))
      await waitFor(() =>
        expect(workflow.getState().workflowRunningData?.result.status).toBe(status),
      )

      act(() => result.current.events.restoreRun('session-1', [resultCard]))

      await waitFor(() =>
        expect(workflow.getState().workflowRunningData?.result.status).toBe('succeeded'),
      )
      expect(mocks.detail).toHaveBeenCalledTimes(2)
      expect(mocks.executions).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['new-run', 'reset'] as const)(
    'ignores a delayed history error after %s',
    async (mode) => {
      let reject!: (error: Error) => void
      mocks.detail.mockReturnValueOnce(
        new Promise((_resolve, fail) => {
          reject = fail
        }),
      )
      const { result, store } = setup()
      act(() => result.current.events.restoreRun('session-1', [resultCard]))
      await waitFor(() => expect(mocks.detail).toHaveBeenCalledOnce())
      act(() => {
        if (mode === 'reset') result.current.events.reset()
        else
          result.current.events.onWorkflowEvent(
            workflowEvent(runStarted('new-run'), { at_version: 3 }),
          )
      })

      await act(async () => reject(new Error('Obsolete request failed')))

      expect(store.get(difyBuilderErrorAtom)).toBe('')
    },
  )

  it.each(['new-run', 'reset'] as const)(
    'ignores a delayed history response after %s',
    async (mode) => {
      let resolve!: (response: WorkflowRunNodeExecutionListResponse) => void
      mocks.executions.mockReturnValue(
        new Promise((done) => {
          resolve = done
        }),
      )
      const { result, workflow, nodeStatus } = setup()
      act(() => result.current.events.restoreRun('session-1', [resultCard]))
      await waitFor(() => expect(mocks.executions).toHaveBeenCalledOnce())
      act(() =>
        mode === 'reset'
          ? result.current.events.reset()
          : result.current.events.onWorkflowEvent(
              workflowEvent(runStarted('new-run'), { at_version: 3 }),
            ),
      )
      await act(async () =>
        resolve({ data: [{ id: 'old-exec', node_id: 'answer', status: 'failed' }] }),
      )
      expect(workflow.getState().workflowRunningData?.result.id).toBe(
        mode === 'reset' ? undefined : 'new-run',
      )
      expect(nodeStatus()).toBeUndefined()
    },
  )
})
