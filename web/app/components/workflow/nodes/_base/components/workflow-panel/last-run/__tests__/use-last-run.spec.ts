import { act } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import { TabType } from '../../types'
import useLastRun from '../use-last-run'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockShowSingleRun = vi.fn()
const mockHandleRun = vi.fn()
const mockHideSingleRun = vi.fn()
const mockInvalidLastRun = vi.fn()
const mockFetchInspectVars = vi.fn()

vi.mock('@/app/components/workflow/nodes/human-input/hooks/use-single-run-form-params', () => ({
  default: () => ({}),
}))

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
    hideSingleRun: mockHideSingleRun,
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
  useInvalidLastRun: () => mockInvalidLastRun,
}))

describe('useLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchInspectVars.mockResolvedValue(undefined)
  })

  it.each([undefined, '2'])(
    'shows persisted variables after V2 form submission and preserves V1 last-run behavior (%s)',
    async (version) => {
      const { result, store } = renderWorkflowHook(
        () =>
          useLastRun({
            id: 'human-input-node',
            flowId: 'flow-id',
            flowType: FlowType.appFlow,
            data: { type: BlockEnum.HumanInput, title: 'Human Input', desc: '', version },
            defaultRunInputData: {},
            isPaused: false,
          }),
        { hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
      )
      await act(async () => {
        store.getState().setNodesWithInspectVars([
          {
            nodeId: 'human-input-node',
            title: 'Human Input',
            nodeType: BlockEnum.HumanInput,
            nodePayload: { type: BlockEnum.HumanInput, title: 'Human Input', desc: '' },
            vars: [],
            isValueFetched: true,
          },
        ])
        await result.current.handleAfterCustomSingleRun()
      })
      expect(mockHideSingleRun).toHaveBeenCalledOnce()
      if (version === '2') {
        expect(store.getState().showVariableInspectPanel).toBe(true)
        expect(store.getState().currentFocusNodeId).toBeNull()
        expect(mockFetchInspectVars).toHaveBeenCalledWith({})
        expect(result.current.tabType).toBe(TabType.settings)
        expect(mockInvalidLastRun).not.toHaveBeenCalled()
      } else {
        expect(result.current.tabType).toBe(TabType.lastRun)
        expect(store.getState().nodesWithInspectVars[0]?.isValueFetched).toBe(true)
        expect(mockInvalidLastRun).toHaveBeenCalledOnce()
        expect(mockFetchInspectVars).not.toHaveBeenCalled()
      }
    },
  )

  it('waits for the real variable list refresh before opening a first V2 result with no cached node', async () => {
    let resolveRefresh!: () => void
    mockFetchInspectVars.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const { result, store } = renderWorkflowHook(
      () =>
        useLastRun({
          id: 'human-input-node',
          flowId: 'flow-id',
          flowType: FlowType.appFlow,
          data: { type: BlockEnum.HumanInput, title: 'Human Input', desc: '', version: '2' },
          defaultRunInputData: {},
          isPaused: false,
        }),
      { hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
    )
    expect(store.getState().nodesWithInspectVars).toEqual([])
    act(() => {
      store.getState().setCurrentFocusNodeId('previous-node')
    })
    let completion!: Promise<void>
    act(() => {
      completion = result.current.handleAfterCustomSingleRun()
    })
    expect(mockFetchInspectVars).toHaveBeenCalledWith({})
    expect(store.getState().showVariableInspectPanel).toBe(false)
    expect(mockHideSingleRun).not.toHaveBeenCalled()
    await act(async () => {
      resolveRefresh()
      await completion
    })
    expect(store.getState().showVariableInspectPanel).toBe(true)
    expect(store.getState().currentFocusNodeId).toBeNull()
    expect(mockHideSingleRun).toHaveBeenCalledOnce()
  })

  it('keeps the V2 form open when refreshing persisted results fails', async () => {
    mockFetchInspectVars.mockRejectedValueOnce(new Error('Variables unavailable'))
    const { result, store } = renderWorkflowHook(
      () =>
        useLastRun({
          id: 'human-input-node',
          flowId: 'flow-id',
          flowType: FlowType.appFlow,
          data: { type: BlockEnum.HumanInput, title: 'Human Input', desc: '', version: '2' },
          defaultRunInputData: {},
          isPaused: false,
        }),
      { hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
    )
    await act(async () => {
      await expect(result.current.handleAfterCustomSingleRun()).rejects.toThrow(
        'Variables unavailable',
      )
    })
    expect(store.getState().showVariableInspectPanel).toBe(false)
    expect(mockHideSingleRun).not.toHaveBeenCalled()
  })

  it('syncs the draft before opening a custom single-run form', () => {
    const { result } = renderWorkflowHook(() =>
      useLastRun({
        id: 'data-source-node',
        flowId: 'flow-id',
        flowType: FlowType.appFlow,
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
