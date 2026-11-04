import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act } from '@testing-library/react'
import {
  baseRunningData,
  renderWorkflowCanvasHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineStartRunByCanEdit } from '../use-pipeline-start-run'

// Draft persistence has its own suite; here it only gates when the run panel opens.
const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

const renderStartRun = (initialStoreState: Record<string, unknown> = {}) =>
  renderWorkflowCanvasHook(() => usePipelineStartRunByCanEdit(true), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    initialStoreState,
  })

describe('usePipelineStartRunByCanEdit', () => {
  beforeEach(() => {
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
  })

  it('saves the draft before opening datasource preparation in the run panel', async () => {
    const pending = createDeferred<void>()
    mockDoSyncWorkflowDraft.mockReturnValue(pending.promise)
    const { result, store } = renderStartRun({
      showEnvPanel: true,
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
    })

    let running!: Promise<void>
    act(() => {
      running = result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(store.getState()).toMatchObject({
      showEnvPanel: false,
      showInputFieldPanel: false,
      showInputFieldPreviewPanel: false,
      isPreparingDataSource: false,
      showDebugAndPreviewPanel: false,
    })

    await act(async () => {
      pending.resolve()
      await running
    })

    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(store.getState()).toMatchObject({
      isPreparingDataSource: true,
      showDebugAndPreviewPanel: true,
    })
  })

  it('ignores a start request while a run is in progress', async () => {
    const runningData = baseRunningData({ result: { status: WorkflowRunningStatus.Running } })
    const { result, store } = renderStartRun({
      workflowRunningData: runningData,
      showEnvPanel: true,
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({
      workflowRunningData: runningData,
      showEnvPanel: true,
    })
  })

  it('returns a finished run to datasource preparation', async () => {
    const { result, store } = renderStartRun({
      workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Succeeded } }),
    })

    await act(async () => {
      await result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(store.getState()).toMatchObject({
      isPreparingDataSource: true,
      workflowRunningData: undefined,
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('closes an open run panel instead of starting another run', async () => {
    const { result, store } = renderStartRun({
      showDebugAndPreviewPanel: true,
      isPreparingDataSource: true,
    })

    act(() => {
      result.current.handleStartWorkflowRun()
    })

    expect(store.getState()).toMatchObject({
      isPreparingDataSource: false,
      showDebugAndPreviewPanel: false,
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })
})
