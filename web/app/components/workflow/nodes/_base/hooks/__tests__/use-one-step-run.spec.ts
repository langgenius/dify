import { act } from '@testing-library/react'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { HttpError } from '@/service/http-error'
import useOneStepRun from '../use-one-step-run'

const mockWorkflowState = {
  conversationVariables: [],
  dataSourceList: [],
  nodesWithInspectVars: [],
  setNodesWithInspectVars: vi.fn(),
  setShowSingleRunPanel: vi.fn(),
  setIsListening: vi.fn(),
  setListeningTriggerType: vi.fn(),
  setListeningTriggerNodeId: vi.fn(),
  setListeningTriggerNodeIds: vi.fn(),
  setListeningTriggerIsAll: vi.fn(),
  setShowVariableInspectPanel: vi.fn(),
}
vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../../../hooks/use-node-data-update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-node-data-update')>()

  return {
    ...actual,
    useNodeDataUpdate: () => ({
      handleNodeDataUpdate: vi.fn(),
    }),
  }
})

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()

  return {
    ...actual,

    useWorkflow: () => ({
      getBeforeNodesInSameBranch: () => [
        {
          id: 'start',
          data: {
            type: 'start',
            title: 'Start',
            variables: [],
          },
        },
      ],
      getBeforeNodesInSameBranchIncludeParent: () => [
        {
          id: 'start',
          data: {
            type: 'start',
            title: 'Start',
            variables: [],
          },
        },
      ],
    }),
  }
})

vi.mock('../../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    appendNodeInspectVars: vi.fn(),
    invalidateSysVarValues: vi.fn(),
    invalidateConversationVarValues: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowState) => unknown) => selector(mockWorkflowState),
  useWorkflowStore: () => ({
    getState: () => mockWorkflowState,
  }),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.tools.builtin.get': () => ({ data: [] }),
    'workspaces.current.tools.api.get': () => ({ data: [] }),
    'workspaces.current.tools.workflow.get': () => ({ data: [] }),
    'workspaces.current.tools.mcp.get': () => ({ data: [] }),
  })
})

vi.mock('@/service/use-workflow', () => ({
  useInvalidateLastRun: () => vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchNodeInspectVars: vi.fn(),
  singleNodeRun: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    consoleClient: {
      apps: {
        byAppId: {
          workflows: { draft: { nodes: { byNodeId: { trigger: { run: { post: vi.fn() } } } } } },
        },
      },
    },
    consoleQuery: actual.consoleQuery,
  }
})

vi.mock('@/service/base', () => ({
  ssePost: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({
    schemaTypeDefinitions: [],
  }),
}))

const renderUseOneStepRun = (type: BlockEnum = BlockEnum.IfElse) =>
  renderHook(
    () =>
      useOneStepRun({
        id: 'if-else-node',
        resource: { kind: 'app', appId: 'app-id', mode: 'workflow' },

        data: {
          type,
          title: 'IF/ELSE',
          desc: '',
        },
        defaultRunInputData: {},
        isRunAfterSingleRun: false,
        isPaused: false,
      }),
    { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
  )

describe('useOneStepRun single-run input vars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'location', {
      value: {
        pathname: '/app/test-app/workflow',
      },
      configurable: true,
    })
  })

  it('uses value_type when the variable cannot be resolved from output vars', () => {
    const { result } = renderUseOneStepRun()

    const inputs = result.current.toVarInputs([
      {
        variable: '#start.amount#',
        value_selector: ['start', 'amount'],
        value_type: VarType.number,
      },
    ])

    expect(inputs).toMatchObject([
      {
        variable: '#start.amount#',
        type: InputVarType.number,
      },
    ])
  })

  it('resolves global system vars by full variable name', () => {
    const { result } = renderUseOneStepRun()

    const inputs = result.current.varSelectorsToVarInputs([['sys', 'timestamp']])

    expect(inputs).toMatchObject([
      {
        variable: '#sys.timestamp#',
        type: InputVarType.number,
      },
    ])
  })

  it.each([BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin])(
    'runs %s with the app identity and supports aborting polling requests',
    async (type) => {
      const run = vi.mocked(
        consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
      )
      run.mockResolvedValueOnce({ id: 'execution-1', status: 'succeeded' })
      const { result } = renderUseOneStepRun(type)
      await act(async () => {
        await result.current.handleRun({})
      })
      expect(run.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-id', node_id: 'if-else-node' },
      })
      if (type !== BlockEnum.TriggerSchedule)
        expect(run.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each([BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin])(
    'aborts the pending %s request when listening stops',
    async (type) => {
      const run = vi.mocked(
        consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
      )
      run.mockImplementationOnce(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
      )
      const { result } = renderUseOneStepRun(type)
      await act(async () => {
        const pendingRun = result.current.handleRun({})
        result.current.handleStop()
        expect(await pendingRun).toBe(false)
      })
      expect(run.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('preserves the plugin request error and metadata when reporting a failed run', async () => {
    const error = new HttpError('forbidden', {
      status: 403,
      message: 'Plugin access denied',
      data: { reason: 'PLUGIN_ACCESS_DENIED' },
      cause: { headers: new Headers({ 'X-Request-Id': 'plugin-run-1' }) },
    })
    vi.mocked(
      consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.trigger.run.post,
    ).mockRejectedValueOnce(error)
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderUseOneStepRun(BlockEnum.TriggerPlugin)

    await act(async () => {
      expect(await result.current.handleRun({})).toBe(false)
    })

    expect(toast.error).toHaveBeenCalledWith('Plugin access denied')
    expect(reportError).toHaveBeenCalledWith(error)
    expect(reportError.mock.calls[0]?.[0]).toBe(error)
  })
})
