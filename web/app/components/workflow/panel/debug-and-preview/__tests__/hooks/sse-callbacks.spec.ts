import type { useWorkflowRun } from '../../../../hooks/use-workflow-run'
import type { Shape as WorkflowStoreShape } from '@/app/components/workflow/store/workflow'
import type { VarInInspect } from '@/types/workflow'
import { useQuery } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowFlowHook as renderHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { useSetWorkflowVarsWithValue as useFetchWorkflowInspectVars } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import {
  BlockEnum,
  NodeRunningStatus,
  VarType,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { useChat } from '../../hooks'

type HandleRun = ReturnType<typeof useWorkflowRun>['handleRun']
type RunCallbacks = NonNullable<Parameters<HandleRun>[1]>

const { fetchAllInspectVars, fetchLastRun } = vi.hoisted(() => ({
  fetchAllInspectVars: vi.fn(),
  fetchLastRun: vi.fn(),
}))
const mockHandleRun = vi.fn<HandleRun>()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get': (...args: unknown[]) =>
        fetchLastRun(...args),
    }),
  }
})

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchAllInspectVars: (...args: unknown[]) => fetchAllInspectVars(...args),
}))

// Event fixtures omit unrelated protocol fields while preserving the real callback names.
type EventFixture<T> = T extends object ? { [K in keyof T]?: EventFixture<T[K]> } : T
type SSECallbacks = {
  [K in keyof RunCallbacks]-?: NonNullable<RunCallbacks[K]> extends (...args: infer A) => infer R
    ? (...args: { [I in keyof A]: EventFixture<A[I]> }) => R
    : never
}

const inspectNode = createNode({
  id: 'node-1',
  data: {
    type: BlockEnum.Code,
    title: 'Code',
    outputs: { answer: { type: VarType.string } },
    _runningStatus: NodeRunningStatus.Succeeded,
  },
})

const inspectVar: VarInInspect = {
  id: 'var-1',
  type: 'node',
  name: 'answer',
  description: 'Answer',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'completed',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: null,
}

type FetchInspectVars = ReturnType<typeof useFetchWorkflowInspectVars>['fetchInspectVars']

function useChatWithRealInspector(
  config: Parameters<typeof useChat>[0],
  registerFetchInspectVars: (fetchInspectVars: FetchInspectVars) => void,
) {
  const { fetchInspectVars } = useFetchWorkflowInspectVars()
  useQuery({
    ...consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions({
      input: { params: { app_id: 'app-1', node_id: 'node-1' } },
    }),
    staleTime: Infinity,
  })
  useLayoutEffect(() => {
    registerFetchInspectVars(fetchInspectVars)
  }, [fetchInspectVars, registerFetchInspectVars])
  return useChat(config)
}

describe('useChat – handleSend SSE callbacks', () => {
  let capturedCallbacks: SSECallbacks

  beforeEach(() => {
    mockHandleRun.mockReset()
    fetchAllInspectVars.mockReset().mockResolvedValue([inspectVar])
    fetchLastRun.mockReset().mockResolvedValue({ id: 'last-run-2', status: 'succeeded' })
    mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
      capturedCallbacks = callbacks as SSECallbacks
    })
  })

  function renderChat(
    config: Parameters<typeof useChat>[0] = {},
    initialStoreState: Partial<WorkflowStoreShape> = {},
  ) {
    let realFetchInspectVars: FetchInspectVars = async () => undefined
    const fetchInspectVars: FetchInspectVars = (params) => realFetchInspectVars(params)
    const registerFetchInspectVars = (nextFetchInspectVars: FetchInspectVars) => {
      realFetchInspectVars = nextFetchInspectVars
    }
    const { queryClient } = createConsoleQueryWrapper()
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
    const lastRunKey =
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
        input: { params: { app_id: 'app-1', node_id: 'node-1' } },
      })
    queryClient.setQueryData(lastRunKey, { id: 'last-run-1', status: 'succeeded' })

    return {
      ...renderHook(() => useChatWithRealInspector(config, registerFetchInspectVars), {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        nodes: [inspectNode],
        queryClient,
        initialStoreState,
        hooksStoreProps: { handleRun: mockHandleRun, fetchInspectVars },
      }),
      lastRunKey,
      queryClient,
    }
  }

  function setupAndSend(
    config: Parameters<typeof useChat>[0] = {},
    initialStoreState: Parameters<typeof renderChat>[1] = {},
  ) {
    const hook = renderChat(config, initialStoreState)
    act(() => {
      hook.result.current.handleSend(
        { query: 'test' },
        {
          onGetSuggestedQuestions: vi.fn().mockResolvedValue({ data: ['q1'] }),
        },
      )
    })
    return hook
  }

  function startWorkflow(overrides: Record<string, unknown> = {}) {
    act(() => {
      capturedCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: undefined,
        message_id: undefined,
        ...overrides,
      })
    })
  }

  function startNode(nodeId: string, traceId: string, extra: Record<string, unknown> = {}) {
    act(() => {
      capturedCallbacks.onNodeStarted({
        data: { node_id: nodeId, id: traceId, ...extra },
      })
    })
  }

  describe('onData', () => {
    it('accumulates chunks and establishes question, answer and conversation IDs', () => {
      const { result } = setupAndSend()
      act(() => {
        capturedCallbacks.onData('Hello', true, {
          conversationId: 'c1',
          messageId: 'm1',
          taskId: 't1',
        })
        capturedCallbacks.onData(' world', false, {
          conversationId: 'other-conversation',
          messageId: 'm1',
          taskId: 't1',
        })
      })
      expect(result.current.conversationId).toBe('c1')
      expect(result.current.chatList).toEqual([
        expect.objectContaining({ id: 'question-m1', content: 'test', isAnswer: false }),
        expect.objectContaining({
          id: 'm1',
          content: 'Hello world',
          isAnswer: true,
          parentMessageId: 'question-m1',
        }),
      ])
    })

    it('adopts a late message ID without losing earlier content', () => {
      const { result } = setupAndSend()
      act(() => {
        capturedCallbacks.onData('first ', true, {
          conversationId: '',
          messageId: '',
          taskId: 't1',
        })
        capturedCallbacks.onData('second', false, {
          conversationId: 'ignored',
          messageId: 'late-id',
          taskId: 't1',
        })
      })
      expect(result.current.conversationId).toBe('')
      expect(result.current.chatList).toHaveLength(2)
      expect(result.current.chatList[1]).toMatchObject({
        id: 'late-id',
        content: 'first second',
        parentMessageId: 'question-late-id',
      })
    })
  })

  describe('onReasoning', () => {
    const findAnswer = (result: { current: ReturnType<typeof useChat> }) =>
      result.current.chatList.find((item) => item.isAnswer && !item.isOpeningStatement)

    it('should accumulate reasoning per node without leaking into content', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: 'let me ', node_id: 'llm' },
        })
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: 'think', node_id: 'llm' },
        })
      })

      const answer = findAnswer(result)
      expect(answer!.reasoningContent).toEqual({ llm: 'let me think' })
      expect(answer!.reasoningFinished).toBeUndefined()
      expect(answer!.content).toBe('')
    })

    it('should key reasoning by node and fall back to "_" when node_id is absent', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: 'a', node_id: 'llm-1' },
        })
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: 'b', node_id: 'llm-2' },
        })
        capturedCallbacks.onReasoning({ data: { message_id: 'm-1', reasoning: 'c' } })
      })

      expect(findAnswer(result)!.reasoningContent).toEqual({ 'llm-1': 'a', 'llm-2': 'b', _: 'c' })
    })

    it('should ignore empty reasoning and mark finished when is_final is set', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: 'done', node_id: 'llm' },
        })
        capturedCallbacks.onReasoning({
          data: { message_id: 'm-1', reasoning: '', node_id: 'llm', is_final: true },
        })
      })

      const answer = findAnswer(result)
      expect(answer!.reasoningContent).toEqual({ llm: 'done' })
      expect(answer!.reasoningFinished).toBe(true)
    })
  })

  describe('onCompleted', () => {
    it('refreshes real inspector state and invalidates cached last-run data when not paused', async () => {
      const { lastRunKey, queryClient, result, store } = setupAndSend()
      expect(result.current.isResponding).toBe(true)
      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })
      expect(result.current.isResponding).toBe(false)
      await waitFor(() =>
        expect(store.getState().nodesWithInspectVars).toEqual([
          expect.objectContaining({
            nodeId: 'node-1',
            vars: [expect.objectContaining({ id: 'var-1', value: 'completed' })],
          }),
        ]),
      )
      await waitFor(() =>
        expect(queryClient.getQueryData(lastRunKey)).toEqual({
          id: 'last-run-2',
          status: 'succeeded',
        }),
      )
    })

    it('leaves inspector and last-run data unchanged when workflow is paused', async () => {
      const { lastRunKey, queryClient, result, store } = setupAndSend(
        {},
        {
          workflowRunningData: baseRunningData({
            result: { status: WorkflowRunningStatus.Paused },
          }),
        },
      )
      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })
      expect(store.getState().nodesWithInspectVars).toEqual([])
      expect(queryClient.getQueryData(lastRunKey)).toEqual({
        id: 'last-run-1',
        status: 'succeeded',
      })
      expect(result.current.isResponding).toBe(false)
    })

    it('should set error content on response item when hasError with errorMessage', async () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('partial', true, {
          conversationId: 'c1',
          messageId: 'msg-err',
          taskId: 't1',
        })
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(true, 'Something went wrong')
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-err')
      expect(answer!.content).toBe('Something went wrong')
      expect(answer!.isError).toBe(true)
    })

    it('should not set error content when hasError is true but errorMessage is empty', async () => {
      const { result } = setupAndSend()
      act(() =>
        capturedCallbacks.onData('Partial response', true, {
          messageId: 'partial',
          taskId: 't1',
          conversationId: 'c1',
        }),
      )
      await act(async () => {
        await capturedCallbacks.onCompleted(true)
      })
      expect(result.current.isResponding).toBe(false)
      expect(result.current.chatList[1]).toMatchObject({
        id: 'partial',
        content: 'Partial response',
      })
    })

    it('should fetch suggested questions when enabled and invoke abort controller callback', async () => {
      const cancelSuggested = vi.fn()
      const mockGetSuggested = vi
        .fn()
        .mockImplementation((_id: string, onCancel: (cancel: () => void) => void) => {
          onCancel(cancelSuggested)
          return Promise.resolve({ data: ['suggestion1'] })
        })
      const hook = renderChat({ suggested_questions_after_answer: { enabled: true } })

      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        capturedCallbacks = callbacks as SSECallbacks
      })

      act(() => {
        hook.result.current.handleSend(
          { query: 'test' },
          {
            onGetSuggestedQuestions: mockGetSuggested,
          },
        )
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })

      expect(hook.result.current.suggestedQuestions).toEqual(['suggestion1'])
      act(() => hook.result.current.handleStop())
      expect(cancelSuggested).toHaveBeenCalledTimes(1)
    })

    it('should set suggestedQuestions to empty array when fetch fails', async () => {
      const mockGetSuggested = vi.fn().mockRejectedValue(new Error('fail'))
      const hook = renderChat({ suggested_questions_after_answer: { enabled: true } })

      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        capturedCallbacks = callbacks as SSECallbacks
      })

      act(() => {
        hook.result.current.handleSend(
          { query: 'test' },
          {
            onGetSuggestedQuestions: mockGetSuggested,
          },
        )
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })

      expect(hook.result.current.suggestedQuestions).toEqual([])
    })
  })

  describe('onError', () => {
    it('should set isResponding to false', () => {
      const { result } = setupAndSend()
      act(() => {
        capturedCallbacks.onError('Stream failed')
      })
      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('onMessageEnd', () => {
    it('should update citation and files', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('response', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageEnd({
          metadata: { retriever_resources: [{ document_id: 'r1' }] },
          files: [],
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-1')
      expect(answer!.citation).toEqual([{ document_id: 'r1' }])
    })

    it('should default citation to empty array when no retriever_resources', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('response', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageEnd({ metadata: {}, files: [] })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-1')
      expect(answer!.citation).toEqual([])
    })
  })

  describe('onMessageReplace', () => {
    it('should replace answer content on responseItem', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('old', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageReplace({ answer: 'replaced' })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-1')
      expect(answer!.content).toBe('replaced')
    })
  })

  describe('onWorkflowStarted', () => {
    it('should create workflow process with Running status', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          message_id: 'msg-1',
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer).toMatchObject({
        id: 'msg-1',
        workflow_run_id: 'wfr-1',
        parentMessageId: 'question-msg-1',
      })
      expect(result.current.conversationId).toBe('conv-1')
      expect(answer!.workflowProcess!.status).toBe('running')
      expect(answer!.workflowProcess!.tracing).toEqual([])
    })

    it('should not override existing conversationId when conversation_id is null', () => {
      const { result } = setupAndSend()
      startWorkflow()
      expect(result.current.conversationId).toBe('')
    })

    it('should resume existing workflow process when tracing exists', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('n1', 'trace-1')
      startWorkflow({ workflow_run_id: 'wfr-2', task_id: 'task-2' })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.status).toBe('running')
      expect(answer!.workflowProcess!.tracing).toEqual([
        expect.objectContaining({ id: 'trace-1', node_id: 'n1', status: 'running' }),
      ])
    })
  })

  describe('onWorkflowFinished', () => {
    it('should update workflow process status', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.status).toBe('succeeded')
    })

    it('should store workflow finished error on workflow process', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onWorkflowFinished({
          data: { status: 'failed', error: 'Invalid upload file' },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.status).toBe('failed')
      expect(answer!.workflowProcess!.error).toBe('Invalid upload file')
    })
  })

  it.each([
    ['iteration', 'onIterationStart', 'onIterationFinish'],
    ['loop', 'onLoopStart', 'onLoopFinish'],
  ] as const)(
    'updates only the matching %s trace through its lifecycle',
    (_kind, start, finish) => {
      const { result } = setupAndSend()
      startWorkflow()
      act(() => capturedCallbacks[start]({ data: { id: 'trace-1', node_id: 'container' } }))
      const traces = () =>
        result.current.chatList.find((item) => item.isAnswer)!.workflowProcess!.tracing
      expect(traces()).toEqual([
        expect.objectContaining({ id: 'trace-1', node_id: 'container', status: 'running' }),
      ])
      const initial = structuredClone(traces())
      act(() =>
        capturedCallbacks[finish]({
          data: { id: 'unknown', node_id: 'other', status: 'succeeded' },
        }),
      )
      expect(traces()).toEqual(initial)
      act(() =>
        capturedCallbacks[finish]({
          data: {
            id: 'trace-1',
            node_id: 'container',
            status: 'succeeded',
            outputs: { result: 'done' },
          },
        }),
      )
      expect(traces()).toEqual([
        expect.objectContaining({
          id: 'trace-1',
          status: 'succeeded',
          outputs: { result: 'done' },
        }),
      ])
    },
  )

  describe('onNodeStarted / onNodeRetry / onNodeFinished', () => {
    it('should update existing tracing entry with same node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')
      startNode('node-1', 'trace-1-v2')

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace!.id).toBe('trace-1-v2')
      expect(trace!.node_id).toBe('node-1')
      expect(trace!.status).toBe('running')
    })

    it('should push retry data to tracing', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onNodeRetry({
          data: { node_id: 'node-1', id: 'retry-1', retry_index: 1 },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace!.id).toBe('retry-1')
      expect(trace!.node_id).toBe('node-1')
      expect(trace!.retry_index).toBe(1)
    })

    it('should update tracing entry on finish by id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')

      act(() => {
        capturedCallbacks.onNodeFinished({
          data: {
            node_id: 'node-1',
            id: 'trace-1',
            status: 'succeeded',
            outputs: { text: 'done' },
          },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace!.id).toBe('trace-1')
      expect(trace!.status).toBe('succeeded')
      expect(trace!.outputs).toEqual({ text: 'done' })
    })

    it('should not update tracing on finish when id does not match', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')

      act(() => {
        capturedCallbacks.onNodeFinished({
          data: { node_id: 'node-x', id: 'trace-x', status: 'succeeded' },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace!.id).toBe('trace-1')
      expect(trace!.status).toBe('running')
    })
  })

  it.each([undefined, { parallel_id: 'p1' }])(
    'accumulates agent logs by message ID without losing metadata: %j',
    (metadata) => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('agent-node', 'trace-agent', { execution_metadata: metadata })
      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-1', data: { text: 'initial' } },
        })
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-2', data: { text: 'second' } },
        })
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-1', data: { text: 'updated' } },
        })
      })
      const trace = result.current.chatList.find((item) => item.isAnswer)!.workflowProcess!
        .tracing[0]!
      expect(trace.execution_metadata).toEqual({
        ...metadata,
        agent_log: [
          { node_id: 'agent-node', message_id: 'log-1', data: { text: 'updated' } },
          { node_id: 'agent-node', message_id: 'log-2', data: { text: 'second' } },
        ],
      })
    },
  )

  describe('onHumanInputRequired', () => {
    it('should add form data to humanInputFormDataList', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('human-node', 'trace-human')

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: {
            form_id: 'form-human-node',
            node_id: 'human-node',
            form_token: 'token-1',
            form_content: '{{#$output.answer#}}',
            inputs: [],
          },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.humanInputFormDataList).toHaveLength(1)
      expect(answer!.humanInputFormDataList![0]!.node_id).toBe('human-node')
      expect(answer!.humanInputFormDataList![0]!.form_token).toBe('token-1')
      expect(answer!.workflowProcess!.tracing[0]).toMatchObject({
        node_id: 'human-node',
        status: 'paused',
      })
    })

    it('should update existing form for same node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('human-node', 'trace-human')

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: {
            form_id: 'form-human-node',
            node_id: 'human-node',
            form_token: 'token-1',
            form_content: '{{#$output.answer#}}',
            inputs: [],
          },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { form_id: 'form-human-node', node_id: 'human-node', form_token: 'token-2' },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.humanInputFormDataList).toHaveLength(1)
      expect(answer!.humanInputFormDataList![0]!.form_token).toBe('token-2')
    })

    it('should push new form data for different node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { form_id: 'form-human-node-1', node_id: 'human-node-1', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { form_id: 'form-human-node-2', node_id: 'human-node-2', form_token: 'token-2' },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.humanInputFormDataList).toHaveLength(2)
      expect(answer!.humanInputFormDataList![0]!.node_id).toBe('human-node-1')
      expect(answer!.humanInputFormDataList![1]!.node_id).toBe('human-node-2')
    })
  })

  describe('onHumanInputFormFilled', () => {
    it('should remove form and add to filled list', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: {
            form_id: 'form-human-node',
            node_id: 'human-node',
            form_token: 'token-1',
            form_content: '{{#$output.answer#}}',
            inputs: [],
          },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputFormFilled({
          data: {
            form_id: 'form-human-node',
            node_id: 'human-node',
            submitted_data: { answer: 'yes' },
          },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.humanInputFormDataList).toHaveLength(0)
      expect(answer!.humanInputFilledFormDataList).toHaveLength(1)
      expect(answer!.humanInputFilledFormDataList![0]!.node_id).toBe('human-node')
      expect(answer!.humanInputFilledFormDataList![0]!.submitted_data).toEqual({ answer: 'yes' })
      expect(answer!.humanInputFilledFormDataList![0]).toEqual(
        expect.objectContaining({
          form_content: '{{#$output.answer#}}',
          inputs: [],
        }),
      )
    })
  })

  describe('onHumanInputFormTimeout', () => {
    it('should update expiration_time on form data', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { form_id: 'form-human-node', node_id: 'human-node', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputFormTimeout({
          data: { form_id: 'form-human-node', node_id: 'human-node', expiration_time: 1735689600 },
        })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      const form = answer!.humanInputFormDataList!.find((f) => f.node_id === 'human-node')
      expect(form!.expiration_time).toBe(1735689600)
    })
  })

  describe('onWorkflowPaused', () => {
    it('should set status to Paused', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onWorkflowPaused({ data: {} })
      })

      const answer = result.current.chatList.find(
        (item) => item.isAnswer && !item.isOpeningStatement,
      )
      expect(answer!.workflowProcess!.status).toBe('paused')
    })
  })
})
