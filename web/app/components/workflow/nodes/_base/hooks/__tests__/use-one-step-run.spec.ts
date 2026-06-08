import { renderHook } from '@testing-library/react'
import {
  BlockEnum,
  InputVarType,
  VarType,
} from '@/app/components/workflow/types'
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => false,
  useNodeDataUpdate: () => ({
    handleNodeDataUpdate: vi.fn(),
  }),
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
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
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

const renderUseOneStepRun = () => renderHook(() => useOneStepRun({
  id: 'if-else-node',
  flowId: 'app-id',
  flowType: FlowType.appFlow,
  data: {
    type: BlockEnum.IfElse,
    title: 'IF/ELSE',
    desc: '',
  },
  defaultRunInputData: {},
  isRunAfterSingleRun: false,
  isPaused: false,
}))

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

    const inputs = result.current.varSelectorsToVarInputs([
      ['sys', 'timestamp'],
    ])

    expect(inputs).toMatchObject([
      {
        variable: '#sys.timestamp#',
        type: InputVarType.number,
      },
    ])
  })
})
