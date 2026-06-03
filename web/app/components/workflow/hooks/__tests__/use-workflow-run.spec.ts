import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowRun } from '../use-workflow-run'

describe('useWorkflowRun', () => {
  it('returns workflow run handlers from hooks store', () => {
    const handlers = {
      handleBackupDraft: vi.fn(),
      handleLoadBackupDraft: vi.fn(),
      handleRestoreFromPublishedWorkflow: vi.fn(),
      handleRun: vi.fn(),
      handleStopRun: vi.fn(),
    }

    const { result } = renderWorkflowHook(() => useWorkflowRun(), {
      hooksStoreProps: handlers,
    })

    expect(result.current.handleBackupDraft).toBe(handlers.handleBackupDraft)
    expect(result.current.handleLoadBackupDraft).toBe(handlers.handleLoadBackupDraft)
    expect(result.current.handleRestoreFromPublishedWorkflow).toBe(handlers.handleRestoreFromPublishedWorkflow)
    expect(result.current.handleRun).toBe(handlers.handleRun)
    expect(result.current.handleStopRun).toBe(handlers.handleStopRun)
  })
})
