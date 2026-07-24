import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useDSL } from '../use-DSL'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'
import { useWorkflowRun } from '../use-workflow-run'
import { useWorkflowStartRun } from '../use-workflow-start-run'

describe('useDSL', () => {
  it('should return exportCheck and handleExportDSL from hooksStore', () => {
    const mockExportCheck = vi.fn()
    const mockHandleExportDSL = vi.fn()

    const { result } = renderWorkflowHook(() => useDSL(), {
      hooksStoreProps: { exportCheck: mockExportCheck, handleExportDSL: mockHandleExportDSL },
    })

    expect(result.current.exportCheck).toBe(mockExportCheck)
    expect(result.current.handleExportDSL).toBe(mockHandleExportDSL)
  })
})

describe('useWorkflowRun', () => {
  it('should return all run-related handlers from hooksStore', () => {
    const mocks = {
      handleBackupDraft: vi.fn(),
      handleLoadBackupDraft: vi.fn(),
      handleRestoreFromPublishedWorkflow: vi.fn(),
      handleRun: vi.fn(),
      handleStopRun: vi.fn(),
    }

    const { result } = renderWorkflowHook(() => useWorkflowRun(), {
      hooksStoreProps: mocks,
    })

    expect(result.current.handleBackupDraft).toBe(mocks.handleBackupDraft)
    expect(result.current.handleLoadBackupDraft).toBe(mocks.handleLoadBackupDraft)
    expect(result.current.handleRestoreFromPublishedWorkflow).toBe(mocks.handleRestoreFromPublishedWorkflow)
    expect(result.current.handleRun).toBe(mocks.handleRun)
    expect(result.current.handleStopRun).toBe(mocks.handleStopRun)
  })
})

describe('useWorkflowStartRun', () => {
  it('should return all start-run handlers from hooksStore', () => {
    const mocks = {
      handleStartWorkflowRun: vi.fn(),
      handleWorkflowStartRunInWorkflow: vi.fn(),
      handleWorkflowStartRunInChatflow: vi.fn(),
      handleWorkflowTriggerScheduleRunInWorkflow: vi.fn(),
      handleWorkflowTriggerWebhookRunInWorkflow: vi.fn(),
      handleWorkflowTriggerPluginRunInWorkflow: vi.fn(),
      handleWorkflowRunAllTriggersInWorkflow: vi.fn(),
    }

    const { result } = renderWorkflowHook(() => useWorkflowStartRun(), {
      hooksStoreProps: mocks,
    })

    expect(result.current.handleStartWorkflowRun).toBe(mocks.handleStartWorkflowRun)
    expect(result.current.handleWorkflowStartRunInWorkflow).toBe(mocks.handleWorkflowStartRunInWorkflow)
    expect(result.current.handleWorkflowStartRunInChatflow).toBe(mocks.handleWorkflowStartRunInChatflow)
    expect(result.current.handleWorkflowTriggerScheduleRunInWorkflow).toBe(mocks.handleWorkflowTriggerScheduleRunInWorkflow)
    expect(result.current.handleWorkflowTriggerWebhookRunInWorkflow).toBe(mocks.handleWorkflowTriggerWebhookRunInWorkflow)
    expect(result.current.handleWorkflowTriggerPluginRunInWorkflow).toBe(mocks.handleWorkflowTriggerPluginRunInWorkflow)
    expect(result.current.handleWorkflowRunAllTriggersInWorkflow).toBe(mocks.handleWorkflowRunAllTriggersInWorkflow)
  })
})

describe('useWorkflowRefreshDraft', () => {
  it('should return handleRefreshWorkflowDraft from hooksStore', () => {
    const mockRefresh = vi.fn()

    const { result } = renderWorkflowHook(() => useWorkflowRefreshDraft(), {
      hooksStoreProps: { handleRefreshWorkflowDraft: mockRefresh },
    })

    expect(result.current.handleRefreshWorkflowDraft).toBe(mockRefresh)
  })
})
