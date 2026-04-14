import { act, renderHook } from '@testing-library/react'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { useWorkflowStartRun } from '../use-workflow-start-run'

const mockGetNodes = vi.fn()
const mockGetFeaturesState = vi.fn()
const mockHandleCancelDebugAndPreviewPanel = vi.fn()
const mockHandleRun = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockUseIsChatMode = vi.fn()

const mockSetShowDebugAndPreviewPanel = vi.fn()
const mockSetShowInputsPanel = vi.fn()
const mockSetShowEnvPanel = vi.fn()
const mockSetShowGlobalVariablePanel = vi.fn()
const mockSetShowChatVariablePanel = vi.fn()
const mockSetListeningTriggerType = vi.fn()
const mockSetListeningTriggerNodeId = vi.fn()
const mockSetListeningTriggerNodeIds = vi.fn()
const mockSetListeningTriggerIsAll = vi.fn()
const mockSetHistoryWorkflowData = vi.fn()

let workflowStoreState: Record<string, unknown>

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: mockGetFeaturesState,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
  }),
}))

vi.mock('@/app/components/workflow-app/hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
  useWorkflowRun: () => ({
    handleRun: mockHandleRun,
  }),
}))

const createWorkflowStoreState = (overrides: Record<string, unknown> = {}) => ({
  workflowRunningData: undefined,
  showDebugAndPreviewPanel: false,
  setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
  setShowInputsPanel: mockSetShowInputsPanel,
  setShowEnvPanel: mockSetShowEnvPanel,
  setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
  setShowChatVariablePanel: mockSetShowChatVariablePanel,
  setListeningTriggerType: mockSetListeningTriggerType,
  setListeningTriggerNodeId: mockSetListeningTriggerNodeId,
  setListeningTriggerNodeIds: mockSetListeningTriggerNodeIds,
  setListeningTriggerIsAll: mockSetListeningTriggerIsAll,
  setHistoryWorkflowData: mockSetHistoryWorkflowData,
  ...overrides,
})

describe('useWorkflowStartRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = createWorkflowStoreState()
    mockGetNodes.mockReturnValue([
      { id: 'inset-s-1', data: { type: BlockEnum.Start, variables: [] } },
    ])
    mockGetFeaturesState.mockReturnValue({
      features: {
        file: {
          image: {
            enabled: false,
          },
        },
      },
    })
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockUseIsChatMode.mockReturnValue(false)
  })

  it('should run the workflow immediately when there are no start variables and no image upload input', async () => {
    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith({ inputs: {}, files: [] })
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(false)
  })

  it('should open the input panel instead of running immediately when start inputs are required', async () => {
    mockGetNodes.mockReturnValue([
      { id: 'inset-s-1', data: { type: BlockEnum.Start, variables: [{ name: 'query' }] } },
    ])

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(true)
  })

  it('should open the input panel when image upload is enabled even without start variables', async () => {
    mockGetFeaturesState.mockReturnValue({
      features: {
        file: {
          image: {
            enabled: true,
          },
        },
      },
    })

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(true)
  })

  it('should cancel the current debug panel instead of starting another workflow when one is already open', async () => {
    workflowStoreState = createWorkflowStoreState({
      showDebugAndPreviewPanel: true,
    })

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should short-circuit workflow start when a run is already in progress', async () => {
    workflowStoreState = createWorkflowStoreState({
      workflowRunningData: {
        result: {
          status: WorkflowRunningStatus.Running,
        },
      },
    })

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockSetShowEnvPanel).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should configure schedule trigger runs and execute the workflow with schedule options', async () => {
    mockGetNodes.mockReturnValue([
      { id: 'schedule-1', data: { type: BlockEnum.TriggerSchedule } },
    ])

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowTriggerScheduleRunInWorkflow('schedule-1')
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetListeningTriggerType).toHaveBeenCalledWith(BlockEnum.TriggerSchedule)
    expect(mockSetListeningTriggerNodeId).toHaveBeenCalledWith('schedule-1')
    expect(mockSetListeningTriggerNodeIds).toHaveBeenCalledWith(['schedule-1'])
    expect(mockSetListeningTriggerIsAll).toHaveBeenCalledWith(false)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith(
      {},
      undefined,
      {
        mode: TriggerType.Schedule,
        scheduleNodeId: 'schedule-1',
      },
    )
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(false)
  })

  it('should cancel schedule trigger execution when the debug panel is already open', async () => {
    workflowStoreState = createWorkflowStoreState({
      showDebugAndPreviewPanel: true,
    })
    mockGetNodes.mockReturnValue([
      { id: 'schedule-1', data: { type: BlockEnum.TriggerSchedule } },
    ])

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowTriggerScheduleRunInWorkflow('schedule-1')
    })

    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it.each([
    {
      title: 'schedule',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerScheduleRunInWorkflow(undefined),
    },
    {
      title: 'webhook',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: '' }),
    },
    {
      title: 'plugin',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerPluginRunInWorkflow(''),
    },
  ])('should ignore $title trigger execution when the node id is empty', async ({ invoke }) => {
    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await invoke(result.current)
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it.each([
    {
      title: 'schedule',
      warnMessage: 'handleWorkflowTriggerScheduleRunInWorkflow: schedule node not found',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerScheduleRunInWorkflow('schedule-missing'),
    },
    {
      title: 'webhook',
      warnMessage: 'handleWorkflowTriggerWebhookRunInWorkflow: webhook node not found',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: 'webhook-missing' }),
    },
    {
      title: 'plugin',
      warnMessage: 'handleWorkflowTriggerPluginRunInWorkflow: plugin node not found',
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerPluginRunInWorkflow('plugin-missing'),
    },
  ])('should warn when the $title trigger node cannot be found', async ({ warnMessage, invoke }) => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetNodes.mockReturnValue([{ id: 'other-node', data: { type: BlockEnum.Start } }])

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await invoke(result.current)
    })

    expect(consoleWarnSpy).toHaveBeenCalledWith(warnMessage, expect.stringContaining('missing'))
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it.each([
    {
      title: 'webhook',
      nodeId: 'webhook-1',
      nodeType: BlockEnum.TriggerWebhook,
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: 'webhook-1' }),
      expectedParams: { node_id: 'webhook-1' },
      expectedOptions: { mode: TriggerType.Webhook, webhookNodeId: 'webhook-1' },
    },
    {
      title: 'plugin',
      nodeId: 'plugin-1',
      nodeType: BlockEnum.TriggerPlugin,
      invoke: (hook: ReturnType<typeof useWorkflowStartRun>) => hook.handleWorkflowTriggerPluginRunInWorkflow('plugin-1'),
      expectedParams: { node_id: 'plugin-1' },
      expectedOptions: { mode: TriggerType.Plugin, pluginNodeId: 'plugin-1' },
    },
  ])('should configure $title trigger runs with node-specific options', async ({ nodeId, nodeType, invoke, expectedParams, expectedOptions }) => {
    mockGetNodes.mockReturnValue([
      { id: nodeId, data: { type: nodeType } },
    ])

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await invoke(result.current)
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(false)
    expect(mockSetListeningTriggerType).toHaveBeenCalledWith(nodeType)
    expect(mockSetListeningTriggerNodeId).toHaveBeenCalledWith(nodeId)
    expect(mockSetListeningTriggerNodeIds).toHaveBeenCalledWith([nodeId])
    expect(mockSetListeningTriggerIsAll).toHaveBeenCalledWith(false)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith(expectedParams, undefined, expectedOptions)
  })

  it('should run all triggers and mark the listener state as global', async () => {
    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowRunAllTriggersInWorkflow(['trigger-1', 'trigger-2'])
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(false)
    expect(mockSetListeningTriggerIsAll).toHaveBeenCalledWith(true)
    expect(mockSetListeningTriggerNodeIds).toHaveBeenCalledWith(['trigger-1', 'trigger-2'])
    expect(mockSetListeningTriggerNodeId).toHaveBeenCalledWith(null)
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith(
      { node_ids: ['trigger-1', 'trigger-2'] },
      undefined,
      {
        mode: TriggerType.All,
        allNodeIds: ['trigger-1', 'trigger-2'],
      },
    )
  })

  it('should ignore run-all requests when there are no trigger nodes', async () => {
    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      await result.current.handleWorkflowRunAllTriggersInWorkflow([])
    })

    expect(mockSetListeningTriggerIsAll).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should route handleStartWorkflowRun to the chatflow path when chat mode is enabled', async () => {
    mockUseIsChatMode.mockReturnValue(true)

    const { result } = renderHook(() => useWorkflowStartRun())

    await act(async () => {
      result.current.handleStartWorkflowRun()
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowChatVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetHistoryWorkflowData).toHaveBeenCalledWith(undefined)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })
})
