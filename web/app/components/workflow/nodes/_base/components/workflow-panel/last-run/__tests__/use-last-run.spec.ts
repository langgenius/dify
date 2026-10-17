import { act } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import useLastRun from '../use-last-run'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockShowSingleRun = vi.fn()
const mockHandleRun = vi.fn()

vi.mock('../../../../../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

vi.mock('../../../../../../hooks/use-checklist', () => ({
  useWorkflowRunValidation: () => ({
    warningNodes: [],
  }),
}))

vi.mock('../../../../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    conversationVars: [],
    systemVars: [],
    hasSetInspectVar: vi.fn(() => false),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-one-step-run', () => ({
  default: () => ({
    hideSingleRun: vi.fn(),
    handleRun: mockHandleRun,
    getInputVars: vi.fn(() => []),
    toVarInputs: vi.fn(() => []),
    varSelectorsToVarInputs: vi.fn(() => []),
    runInputData: {},
    runInputDataRef: { current: {} },
    setRunInputData: vi.fn(),
    showSingleRun: mockShowSingleRun,
    runResult: {},
    iterationRunResult: [],
    loopRunResult: [],
    setNodeRunning: vi.fn(),
    checkValid: vi.fn(() => ({ isValid: true })),
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateLastRun: () => vi.fn(),
}))

describe('useLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests draft sync and opens a custom single-run form without running the node', () => {
    const { result } = renderWorkflowHook(() =>
      useLastRun({
        id: 'data-source-node',
        resource: { kind: 'app', appId: 'flow-id', mode: 'workflow' },

        data: {
          type: BlockEnum.DataSource,
          title: 'Data Source',
          desc: '',
        },
        defaultRunInputData: {},
        isPaused: false,
      }),
    )

    act(() => {
      result.current.handleSingleRun()
    })

    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    expect(mockShowSingleRun).toHaveBeenCalledTimes(1)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })
})
