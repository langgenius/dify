import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
// oxlint-disable-next-line no-restricted-imports
import { ssePost } from '@/service/base'
import { getIterationSingleNodeRunUrl, getLoopSingleNodeRunUrl } from '@/service/workflow'
import { FlowType } from '@/types/common'
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
vi.mock('@langgenius/dify-ui/toast', () => ({
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
    useIsChatMode: () => false,
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

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidLastRun: () => vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchNodeInspectVars: vi.fn(),
  getIterationSingleNodeRunUrl: vi.fn(),
  getLoopSingleNodeRunUrl: vi.fn(),
  singleNodeRun: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  post: vi.fn(),
  ssePost: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('../components/variable/use-match-schema-type', () => ({
  default: () => ({
    schemaTypeDefinitions: [],
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({
    schemaTypeDefinitions: [],
  }),
}))

vi.mock('@/app/components/workflow/nodes/assigner/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/code/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/document-extractor/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/http/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/human-input/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/if-else/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/iteration/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/llm/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/loop/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/parameter-extractor/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/question-classifier/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/template-transform/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/tool/default', () => ({
  default: {},
}))
vi.mock('@/app/components/workflow/nodes/variable-assigner/default', () => ({
  default: {},
}))

const renderUseOneStepRun = (type = BlockEnum.IfElse, flowType = FlowType.appFlow) =>
  renderHook(() =>
    useOneStepRun({
      id: 'if-else-node',
      flowId: 'app-id',
      flowType,
      data: {
        type,
        title: 'IF/ELSE',
        desc: '',
      },
      defaultRunInputData: {},
      isRunAfterSingleRun: false,
      isPaused: false,
    }),
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

  it.each([
    {
      type: BlockEnum.Iteration,
      flowType: FlowType.appFlow,
      getRunUrl: getIterationSingleNodeRunUrl,
      runUrl: '/apps/app-id/workflows/draft/iteration/nodes/if-else-node/run',
      reconnectUrl: '/workflow/single-run-id/events',
    },
    {
      type: BlockEnum.Loop,
      flowType: FlowType.appFlow,
      getRunUrl: getLoopSingleNodeRunUrl,
      runUrl: '/apps/app-id/workflows/draft/loop/nodes/if-else-node/run',
      reconnectUrl: '/workflow/single-run-id/events',
    },
    {
      type: BlockEnum.Iteration,
      flowType: FlowType.ragPipeline,
      getRunUrl: getIterationSingleNodeRunUrl,
      runUrl: '/rag/pipelines/app-id/workflows/draft/iteration/nodes/if-else-node/run',
      reconnectUrl: '/rag/pipelines/app-id/workflow-runs/single-run-id/events',
    },
    {
      type: BlockEnum.Loop,
      flowType: FlowType.ragPipeline,
      getRunUrl: getLoopSingleNodeRunUrl,
      runUrl: '/rag/pipelines/app-id/workflows/draft/loop/nodes/if-else-node/run',
      reconnectUrl: '/rag/pipelines/app-id/workflow-runs/single-run-id/events',
    },
    {
      type: BlockEnum.Iteration,
      flowType: FlowType.snippet,
      getRunUrl: getIterationSingleNodeRunUrl,
      runUrl: '/snippets/app-id/workflows/draft/iteration/nodes/if-else-node/run',
      reconnectUrl: '/snippets/app-id/workflow-runs/single-run-id/events',
    },
    {
      type: BlockEnum.Loop,
      flowType: FlowType.snippet,
      getRunUrl: getLoopSingleNodeRunUrl,
      runUrl: '/snippets/app-id/workflows/draft/loop/nodes/if-else-node/run',
      reconnectUrl: '/snippets/app-id/workflow-runs/single-run-id/events',
    },
  ])('uses the resumable workflow stream contract for a single $type run', async (scenario) => {
    vi.mocked(scenario.getRunUrl).mockReturnValue(scenario.runUrl)
    const { result } = renderUseOneStepRun(scenario.type, scenario.flowType)

    await act(async () => {
      await result.current.handleRun({ input: 'value' })
    })

    expect(ssePost).toHaveBeenCalledWith(
      scenario.runUrl,
      { body: { inputs: { input: 'value' } } },
      expect.objectContaining({
        workflowStreamReconnect: expect.objectContaining({
          resolveUrl: expect.any(Function),
        }),
      }),
    )
    const callbacks = vi.mocked(ssePost).mock.calls[0]![2]
    expect(callbacks.workflowStreamReconnect).not.toBe(false)
    if (callbacks.workflowStreamReconnect)
      expect(callbacks.workflowStreamReconnect.resolveUrl?.('single-run-id')).toBe(
        scenario.reconnectUrl,
      )

    expect(() => {
      act(() => {
        callbacks.onWorkflowFinished?.({
          workflow_run_id: 'single-run-id',
          task_id: 'single-task-id',
          event: 'workflow_finished',
          data: {
            id: 'single-run-id',
            status: 'succeeded',
            created_by: { name: 'Dify' },
          },
        } as never)
      })
    }).not.toThrow()
  })
})
