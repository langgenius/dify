import type { ReactNode } from 'react'
import type { Features } from '@/app/components/base/features/types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { Shape } from '@/app/components/workflow/store'
import type { Node } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowCanvasHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowStartRunByCanEdit } from '../use-workflow-start-run'

// Draft persistence and the run stream are owned by their own hooks and suites.
const mockHandleRun = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('../use-workflow-run', () => ({
  useWorkflowRunByCanEdit: () => ({
    handleRun: mockHandleRun,
  }),
}))

let workflowStoreState: Partial<Shape>
let canvasNodes: Node[]
let features: Partial<Features>
let workflowStore: ReturnType<typeof renderWorkflowCanvasHook>['store']

const toNodes = (nodes: { id: string; data: Record<string, unknown> }[]) =>
  nodes.map(({ id, data }) => createNode({ id, data }))

const renderHook = <R,>(callback: () => R, { resource }: { resource: EditorResource }) => {
  const featuresStore = createFeaturesStore({ features })
  const rendered = renderWorkflowCanvasHook(callback, {
    resource,
    initialStoreState: workflowStoreState,
    nodes: canvasNodes,
    wrapper: ({ children }: { children: ReactNode }) => (
      <FeaturesContext value={featuresStore}>{children}</FeaturesContext>
    ),
  })
  workflowStore = rendered.store
  return rendered
}

const createWorkflowStoreState = (overrides: Partial<Shape> = {}): Partial<Shape> => ({
  showDebugAndPreviewPanel: false,
  showEnvPanel: true,
  showGlobalVariablePanel: true,
  showChatVariablePanel: true,
  ...overrides,
})

describe('useWorkflowStartRunByCanEdit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    workflowStoreState = createWorkflowStoreState()
    canvasNodes = toNodes([{ id: 'inset-s-1', data: { type: BlockEnum.Start, variables: [] } }])
    features = { file: { image: { enabled: false } } }
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
  })

  it('should run the workflow immediately when there are no start variables and no image upload input', async () => {
    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(workflowStore.getState().showEnvPanel).toEqual(false)
    expect(workflowStore.getState().showGlobalVariablePanel).toEqual(false)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith({ inputs: {}, files: [] })
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
    expect(workflowStore.getState().showInputsPanel).toEqual(false)
  })

  it('should not sync or run when only the start placeholder exists', async () => {
    canvasNodes = toNodes([{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }])

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)
    expect(workflowStore.getState().showInputsPanel).toBe(false)
  })

  it('should open the input panel instead of running immediately when start inputs are required', async () => {
    canvasNodes = toNodes([
      { id: 'inset-s-1', data: { type: BlockEnum.Start, variables: [{ name: 'query' }] } },
    ])

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
    expect(workflowStore.getState().showInputsPanel).toEqual(true)
  })

  it('should open the input panel when image upload is enabled even without start variables', async () => {
    features = { file: { image: { enabled: true } } }

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
    expect(workflowStore.getState().showInputsPanel).toEqual(true)
  })

  it('should cancel the current debug panel instead of starting another workflow when one is already open', async () => {
    workflowStoreState = createWorkflowStoreState({
      showDebugAndPreviewPanel: true,
    })

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should short-circuit workflow start when a run is already in progress', async () => {
    workflowStoreState = createWorkflowStoreState({
      workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Running } }),
    })

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(workflowStore.getState().showEnvPanel).toBe(true)
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should configure schedule trigger runs and execute the workflow with schedule options', async () => {
    canvasNodes = toNodes([{ id: 'schedule-1', data: { type: BlockEnum.TriggerSchedule } }])

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowTriggerScheduleRunInWorkflow('schedule-1')
    })

    expect(workflowStore.getState().showEnvPanel).toEqual(false)
    expect(workflowStore.getState().showGlobalVariablePanel).toEqual(false)
    expect(workflowStore.getState().listeningTriggerType).toEqual(BlockEnum.TriggerSchedule)
    expect(workflowStore.getState().listeningTriggerNodeId).toEqual('schedule-1')
    expect(workflowStore.getState().listeningTriggerNodeIds).toEqual(['schedule-1'])
    expect(workflowStore.getState().listeningTriggerIsAll).toEqual(false)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockHandleRun).toHaveBeenCalledWith({}, undefined, {
      mode: TriggerType.Schedule,
      scheduleNodeId: 'schedule-1',
    })
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
    expect(workflowStore.getState().showInputsPanel).toEqual(false)
  })

  it('should cancel schedule trigger execution when the debug panel is already open', async () => {
    workflowStoreState = createWorkflowStoreState({
      showDebugAndPreviewPanel: true,
    })
    canvasNodes = toNodes([{ id: 'schedule-1', data: { type: BlockEnum.TriggerSchedule } }])

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowTriggerScheduleRunInWorkflow('schedule-1')
    })

    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it.each([
    {
      title: 'schedule',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerScheduleRunInWorkflow(undefined),
    },
    {
      title: 'webhook',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: '' }),
    },
    {
      title: 'plugin',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerPluginRunInWorkflow(''),
    },
  ])('should ignore $title trigger execution when the node id is empty', async ({ invoke }) => {
    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await invoke(result.current)
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it.each([
    {
      title: 'schedule',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerScheduleRunInWorkflow('schedule-missing'),
    },
    {
      title: 'webhook',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: 'webhook-missing' }),
    },
    {
      title: 'plugin',
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerPluginRunInWorkflow('plugin-missing'),
    },
  ])('does not run when the $title trigger node cannot be found', async ({ invoke }) => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    canvasNodes = toNodes([{ id: 'other-node', data: { type: BlockEnum.Start } }])

    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await invoke(result.current)
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it.each([
    {
      title: 'webhook',
      nodeId: 'webhook-1',
      nodeType: BlockEnum.TriggerWebhook,
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerWebhookRunInWorkflow({ nodeId: 'webhook-1' }),
      expectedParams: { node_id: 'webhook-1' },
      expectedOptions: { mode: TriggerType.Webhook, webhookNodeId: 'webhook-1' },
    },
    {
      title: 'plugin',
      nodeId: 'plugin-1',
      nodeType: BlockEnum.TriggerPlugin,
      invoke: (hook: ReturnType<typeof useWorkflowStartRunByCanEdit>) =>
        hook.handleWorkflowTriggerPluginRunInWorkflow('plugin-1'),
      expectedParams: { node_id: 'plugin-1' },
      expectedOptions: { mode: TriggerType.Plugin, pluginNodeId: 'plugin-1' },
    },
  ])(
    'should configure $title trigger runs with node-specific options',
    async ({ nodeId, nodeType, invoke, expectedParams, expectedOptions }) => {
      canvasNodes = toNodes([{ id: nodeId, data: { type: nodeType } }])

      const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      })

      await act(async () => {
        await invoke(result.current)
      })

      expect(workflowStore.getState().showEnvPanel).toEqual(false)
      expect(workflowStore.getState().showGlobalVariablePanel).toEqual(false)
      expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
      expect(workflowStore.getState().showInputsPanel).toEqual(false)
      expect(workflowStore.getState().listeningTriggerType).toEqual(nodeType)
      expect(workflowStore.getState().listeningTriggerNodeId).toEqual(nodeId)
      expect(workflowStore.getState().listeningTriggerNodeIds).toEqual([nodeId])
      expect(workflowStore.getState().listeningTriggerIsAll).toEqual(false)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      expect(mockHandleRun).toHaveBeenCalledWith(expectedParams, undefined, expectedOptions)
    },
  )

  it('should run all triggers and mark the listener state as global', async () => {
    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowRunAllTriggersInWorkflow(['trigger-1', 'trigger-2'])
    })

    expect(workflowStore.getState().showEnvPanel).toEqual(false)
    expect(workflowStore.getState().showGlobalVariablePanel).toEqual(false)
    expect(workflowStore.getState().showInputsPanel).toEqual(false)
    expect(workflowStore.getState().listeningTriggerIsAll).toEqual(true)
    expect(workflowStore.getState().listeningTriggerNodeIds).toEqual(['trigger-1', 'trigger-2'])
    expect(workflowStore.getState().listeningTriggerNodeId).toEqual(null)
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
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
    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleWorkflowRunAllTriggersInWorkflow([])
    })

    expect(workflowStore.getState().listeningTriggerIsAll).toBe(false)
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should route handleStartWorkflowRun to the chatflow path when chat mode is enabled', async () => {
    const { result } = renderHook(() => useWorkflowStartRunByCanEdit(true), {
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    })

    await act(async () => {
      result.current.handleStartWorkflowRun()
    })

    expect(workflowStore.getState().showEnvPanel).toEqual(false)
    expect(workflowStore.getState().showChatVariablePanel).toEqual(false)
    expect(workflowStore.getState().showGlobalVariablePanel).toEqual(false)
    expect(workflowStore.getState().showDebugAndPreviewPanel).toEqual(true)
    expect(workflowStore.getState().historyWorkflowData).toEqual(undefined)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })
})
