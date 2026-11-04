import type { useWorkflowRun } from '../../../../hooks/use-workflow-run'
import type { Shape as WorkflowStoreShape } from '@/app/components/workflow/store/workflow'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
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
type ResumeCallbacks = Parameters<ReturnType<typeof useChat>['handleResume']>[2]

const { fetchAllInspectVars, fetchLastRun, mockSubmitHumanInputForm } = vi.hoisted(() => ({
  fetchAllInspectVars: vi.fn(),
  fetchLastRun: vi.fn(),
  mockSubmitHumanInputForm: vi.fn(),
}))
const mockHandleRun = vi.fn<HandleRun>()
const mockNotify = vi.fn()
const mockSseGet = vi.fn()
vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

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
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: unknown[]) => mockNotify(...args),
  },
}))

// Protocol fixtures supply the fields relevant to each stream transition.
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
  value: 'after-resume',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: null,
}

const previousInspectVar: VarInInspect = { ...inspectVar, value: 'before-resume' }
const previousInspectorState: NodeWithVar[] = [
  {
    nodeId: 'node-1',
    nodePayload: inspectNode.data,
    nodeType: inspectNode.data.type,
    title: inspectNode.data.title,
    vars: [previousInspectVar],
    isSingRunRunning: false,
    isValueFetched: true,
  },
]

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

describe('useChat – handleResume', () => {
  let capturedResumeOptions: SSECallbacks

  beforeEach(() => {
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
    mockNotify.mockReset()
    mockSubmitHumanInputForm.mockReset()
    fetchAllInspectVars
      .mockReset()
      .mockResolvedValueOnce([previousInspectVar])
      .mockResolvedValue([inspectVar])
    fetchLastRun
      .mockReset()
      .mockResolvedValueOnce({ id: 'last-run-before', status: 'succeeded' })
      .mockResolvedValue({ id: 'last-run-after', status: 'succeeded' })
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
    queryClient.setQueryData(lastRunKey, { id: 'last-run-initial', status: 'succeeded' })

    return {
      ...renderHook(() => useChatWithRealInspector(config, registerFetchInspectVars), {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        nodes: [inspectNode],
        queryClient,
        initialStoreState: { nodesWithInspectVars: previousInspectorState, ...initialStoreState },
        hooksStoreProps: { handleRun: mockHandleRun, fetchInspectVars },
      }),
      lastRunKey,
      queryClient,
    }
  }

  async function setupResumeWithTree(
    config: Parameters<typeof useChat>[0] = {},
    initialStoreState: Partial<WorkflowStoreShape> = {},
    resumeCallbacks: ResumeCallbacks = {},
  ) {
    let sendCallbacks: SSECallbacks
    mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
      sendCallbacks = callbacks as SSECallbacks
    })
    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: RunCallbacks) => {
      capturedResumeOptions = options as SSECallbacks
    })

    const hook = renderChat(config, initialStoreState)

    act(() => {
      hook.result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: undefined,
        message_id: 'msg-resume',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    if (initialStoreState.workflowRunningData?.result.status !== WorkflowRunningStatus.Paused) {
      await waitFor(() => expect(fetchAllInspectVars).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(hook.queryClient.getQueryData(hook.lastRunKey)).toEqual({
          id: 'last-run-before',
          status: 'succeeded',
        }),
      )
    }

    act(() => {
      hook.result.current.handleResume('msg-resume', 'wfr-1', resumeCallbacks)
    })

    return hook
  }

  it('should call sseGet with the correct URL', () => {
    const { result } = renderChat()

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/wfr-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.any(Object),
    )
  })

  it('should abort previous SSE connection when handleResume is called again', () => {
    const mockAbortCtrl = new AbortController()
    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: RunCallbacks) => {
      options.getAbortController!(mockAbortCtrl)
    })

    const { result } = renderChat()

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: RunCallbacks) => {
      options.getAbortController!(new AbortController())
    })

    act(() => {
      result.current.handleResume('msg-1', 'wfr-2', {})
    })

    expect(mockAbortCtrl.signal.aborted).toBe(true)
  })

  it('should abort previous workflowEventsAbortController before sseGet', () => {
    const abortController = new AbortController()
    let sendCallbacks: SSECallbacks
    mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
      sendCallbacks = callbacks as SSECallbacks
    })

    const { result } = renderChat()

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.getAbortController(abortController)
    })

    mockSseGet.mockImplementation(() => {})

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(abortController.signal.aborted).toBe(true)
  })

  describe('onWorkflowStarted', () => {
    it('should resume existing workflow when tracing exists', async () => {
      let sendCallbacks: SSECallbacks
      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        sendCallbacks = callbacks as SSECallbacks
      })
      mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: RunCallbacks) => {
        capturedResumeOptions = options as SSECallbacks
      })

      const hook = renderChat()

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: undefined,
          message_id: 'msg-resume',
        })
      })

      act(() => {
        sendCallbacks.onNodeStarted({
          data: { node_id: 'n1', id: 'trace-1' },
        })
      })

      await act(async () => {
        await sendCallbacks.onCompleted(false)
      })

      act(() => {
        hook.result.current.handleResume('msg-resume', 'wfr-1', {})
      })

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      const answer = hook.result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(hook.result.current.isResponding).toBe(true)
      expect(answer!.workflowProcess).toMatchObject({
        status: 'running',
        tracing: [expect.objectContaining({ id: 'trace-1', node_id: 'n1' })],
      })
    })
  })

  describe('onWorkflowFinished', () => {
    it('should update workflow status', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onWorkflowFinished({
          data: { status: 'succeeded' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('succeeded')
    })

    it('should store workflow finished error on resume workflow process', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onWorkflowFinished({
          data: { status: 'failed', error: 'Invalid upload file' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('failed')
      expect(answer!.workflowProcess!.error).toBe('Invalid upload file')
    })
  })

  describe('onData', () => {
    it('should append message content', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onData('resumed', false, {
          conversationId: 'conv-2',
          messageId: 'msg-resume',
          taskId: 'task-2',
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.content).toContain('resumed')
    })

    it('should update conversationId when provided', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onData('msg', false, {
          conversationId: 'new-conv-resume',
          messageId: undefined,
          taskId: 'task-2',
        })
      })

      expect(result.current.conversationId).toBe('new-conv-resume')
    })
  })

  describe('onReasoning', () => {
    it('should accumulate reasoning per node onto the resumed answer', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onReasoning({
          data: { message_id: 'msg-resume', reasoning: 'resumed ', node_id: 'llm' },
        })
        capturedResumeOptions.onReasoning({
          data: { message_id: 'msg-resume', reasoning: 'thought', node_id: 'llm', is_final: true },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.reasoningContent).toEqual({ llm: 'resumed thought' })
      expect(answer!.reasoningFinished).toBe(true)
    })

    it('should ignore empty reasoning and fall back to "_" when node_id is absent', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: '' } })
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: 'a' } })
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: 'b' } })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.reasoningContent).toEqual({ _: 'ab' })
      expect(answer!.reasoningFinished).toBeUndefined()
    })
  })

  describe('onCompleted', () => {
    it('refreshes inspector and last-run data after a successful resumed workflow', async () => {
      const { lastRunKey, queryClient, result, store } = await setupResumeWithTree()
      act(() =>
        capturedResumeOptions.onWorkflowStarted({ workflow_run_id: 'wfr-1', task_id: 'task-1' }),
      )
      expect(result.current.isResponding).toBe(true)
      expect(store.getState().nodesWithInspectVars[0]?.vars[0]?.value).toBe('before-resume')
      expect(queryClient.getQueryData(lastRunKey)).toEqual({
        id: 'last-run-before',
        status: 'succeeded',
      })

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(result.current.isResponding).toBe(false)
      await waitFor(() =>
        expect(store.getState().nodesWithInspectVars[0]?.vars[0]?.value).toBe('after-resume'),
      )
      await waitFor(() =>
        expect(queryClient.getQueryData(lastRunKey)).toEqual({
          id: 'last-run-after',
          status: 'succeeded',
        }),
      )
    })

    it('preserves inspector and last-run data when the workflow remains paused', async () => {
      const { lastRunKey, queryClient, store } = await setupResumeWithTree(
        {},
        {
          workflowRunningData: baseRunningData({
            result: { status: WorkflowRunningStatus.Paused },
          }),
        },
      )

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(store.getState().nodesWithInspectVars).toEqual(previousInspectorState)
      expect(queryClient.getQueryData(lastRunKey)).toEqual({
        id: 'last-run-initial',
        status: 'succeeded',
      })
      expect(fetchAllInspectVars).not.toHaveBeenCalled()
      expect(fetchLastRun).not.toHaveBeenCalled()
    })

    it('refreshes inspector and last-run data on error but skips suggested questions', async () => {
      const mockGetSuggested = vi.fn().mockResolvedValue({ data: ['s1'] })
      const { lastRunKey, queryClient, store } = await setupResumeWithTree(
        { suggested_questions_after_answer: { enabled: true } },
        {},
        { onGetSuggestedQuestions: mockGetSuggested },
      )

      await act(async () => {
        await capturedResumeOptions.onCompleted(true)
      })

      await waitFor(() =>
        expect(store.getState().nodesWithInspectVars[0]?.vars[0]?.value).toBe('after-resume'),
      )
      await waitFor(() =>
        expect(queryClient.getQueryData(lastRunKey)).toEqual({
          id: 'last-run-after',
          status: 'succeeded',
        }),
      )
      expect(mockGetSuggested).not.toHaveBeenCalled()
    })

    it('should fetch suggested questions when enabled', async () => {
      const mockGetSuggested = vi
        .fn()
        .mockImplementation((_id: string, onCancel: (cancel: () => void) => void) => {
          onCancel(vi.fn())
          return Promise.resolve({ data: ['s1'] })
        })
      const hook = await setupResumeWithTree(
        { suggested_questions_after_answer: { enabled: true } },
        {},
        { onGetSuggestedQuestions: mockGetSuggested },
      )

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(mockGetSuggested).toHaveBeenCalledWith('msg-resume', expect.any(Function))
      expect(hook.result.current.suggestedQuestions).toEqual(['s1'])
    })

    it('should set suggestedQuestions to empty on fetch error', async () => {
      const mockGetSuggested = vi.fn().mockRejectedValue(new Error('fail'))
      const hook = await setupResumeWithTree(
        { suggested_questions_after_answer: { enabled: true } },
        {},
        { onGetSuggestedQuestions: mockGetSuggested },
      )

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(hook.result.current.suggestedQuestions).toEqual([])
    })
  })

  describe('onError', () => {
    it('should set isResponding to false', async () => {
      const { result } = await setupResumeWithTree()
      act(() => {
        capturedResumeOptions.onError('Stream failed')
      })
      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('onMessageEnd', () => {
    it('should update citation and files', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageEnd({
          metadata: { retriever_resources: [{ document_id: 'cite-1' }] },
          files: [],
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.citation).toEqual([{ document_id: 'cite-1' }])
    })
  })

  describe('onMessageReplace', () => {
    it('should replace content', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageReplace({ answer: 'replaced' })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.content).toBe('replaced')
    })
  })

  describe('onIterationStart / onIterationFinish', () => {
    it('should push and update iteration tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onIterationStart({
          data: { id: 'iter-r1', node_id: 'n-iter-r' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('iter-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onIterationFinish({
          data: { id: 'iter-r1', node_id: 'n-iter-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })
  })

  describe('onLoopStart / onLoopFinish', () => {
    it('should push and update loop tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onLoopStart({
          data: { id: 'loop-r1', node_id: 'n-loop-r' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('loop-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onLoopFinish({
          data: { id: 'loop-r1', node_id: 'n-loop-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })
  })

  describe('onNodeStarted / onNodeFinished', () => {
    it('should add and update node tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const startedTrace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-1')
      expect(startedTrace).toBeDefined()
      expect(startedTrace!.id).toBe('rtrace-1')
      expect(startedTrace!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: { node_id: 'rn-1', id: 'rtrace-1', status: 'succeeded' },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const finishedTrace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-1')
      expect(finishedTrace).toBeDefined()
      expect(finishedTrace!.status).toBe('succeeded')
    })

    it('should skip onNodeStarted when iteration_id is present', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-child', id: 'rtrace-child', iteration_id: 'iter-parent' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing.some((t) => t.node_id === 'rn-child')).toBe(false)
    })

    it('should update existing node in tracing on onNodeStarted', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1-v2' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const matchingTraces = answer!.workflowProcess!.tracing.filter((t) => t.node_id === 'rn-1')
      expect(matchingTraces).toHaveLength(1)
      expect(matchingTraces[0]!.id).toBe('rtrace-1-v2')
      expect(matchingTraces[0]!.status).toBe('running')
    })

    it('should match nodeFinished with parallel_id', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1', execution_metadata: { parallel_id: 'p1' } },
        })
      })

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: {
            node_id: 'rn-1',
            id: 'rtrace-1',
            status: 'succeeded',
            execution_metadata: { parallel_id: 'p1' },
          },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t) => t.id === 'rtrace-1')
      expect(trace).toBeDefined()
      expect(trace!.status).toBe('succeeded')
      expect(trace!.execution_metadata!.parallel_id).toBe('p1')
    })
  })

  describe('onHumanInputRequired', () => {
    it('should update existing form for same node and push for different node', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-2' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(1)

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human-2', node_id: 'rn-human-2', form_token: 'rt-3' },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toEqual([
        { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-2' },
        { form_id: 'form-rn-human-2', node_id: 'rn-human-2', form_token: 'rt-3' },
      ])
    })

    it('should set tracing node to Paused when tracing match is found', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-human', id: 'trace-human' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-human')
      expect(trace!.status).toBe('paused')
    })
  })

  describe('onHumanInputFormFilled', () => {
    it('should move form from pending to filled list', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormFilled({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', submitted_data: { a: 'one' } },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(0)
      expect(answer!.humanInputFilledFormDataList).toEqual([
        expect.objectContaining({ node_id: 'rn-human', submitted_data: { a: 'one' } }),
      ])
    })
  })

  describe('onHumanInputFormTimeout', () => {
    it('ignores a late timeout for a submitted form while another form is pending', async () => {
      const { result } = await setupResumeWithTree()
      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-submitted', node_id: 'submitted', form_token: 'one' },
        })
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-pending', node_id: 'pending', form_token: 'two' },
        })
        capturedResumeOptions.onHumanInputFormFilled({
          data: {
            form_id: 'form-submitted',
            node_id: 'submitted',
            submitted_data: { answer: 'yes' },
          },
        })
        capturedResumeOptions.onHumanInputFormTimeout({
          data: { form_id: 'form-submitted', node_id: 'submitted', expiration_time: 1748736000 },
        })
      })
      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toEqual([
        { form_id: 'form-pending', node_id: 'pending', form_token: 'two' },
      ])
      expect(answer!.humanInputFilledFormDataList).toEqual([
        expect.objectContaining({ node_id: 'submitted', submitted_data: { answer: 'yes' } }),
      ])
    })

    it('should set expiration_time on the form entry', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormTimeout({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', expiration_time: 1748736000 },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const form = answer!.humanInputFormDataList!.find((f) => f.node_id === 'rn-human')
      expect(form!.expiration_time).toBe(1748736000)
    })
  })

  describe('onWorkflowPaused', () => {
    it('should keep the resumable stream and set status to Paused', async () => {
      const { result } = await setupResumeWithTree()
      const sseGetCallsBefore = mockSseGet.mock.calls.length

      act(() => {
        capturedResumeOptions.onWorkflowPaused({
          data: { workflow_run_id: 'wfr-paused' },
        })
      })

      expect(mockSseGet.mock.calls.length).toBe(sseGetCallsBefore)
      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('paused')
    })
  })
})
