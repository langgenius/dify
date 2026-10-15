import { ORPCError } from '@orpc/client'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
// oxlint-disable-next-line no-restricted-imports -- Mock the request boundary while preserving the single-run error owner.
import { post } from '@/service/base'
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

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateLastRun: () => vi.fn(),
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

const renderUseOneStepRun = (type: BlockEnum = BlockEnum.IfElse) =>
  renderHook(() =>
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

  it('preserves the plugin request error and metadata when reporting a failed run', async () => {
    const error = new ORPCError('forbidden', {
      status: 403,
      message: 'Plugin access denied',
      data: { reason: 'PLUGIN_ACCESS_DENIED' },
      cause: { headers: new Headers({ 'X-Request-Id': 'plugin-run-1' }) },
    })
    vi.mocked(post).mockRejectedValueOnce(error)
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

vi.mock('@/app/components/workflow/editor-resource/state', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/workflow/editor-resource/state')>()
  const { atom } = await import('jotai')
  return { ...actual, isChatflowAtom: atom(() => false) }
})
