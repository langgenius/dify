import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

describe('useWorkflowRefreshDraft', () => {
  it('returns handleRefreshWorkflowDraft from hooks store', () => {
    const handleRefreshWorkflowDraft = vi.fn()

    const { result } = renderWorkflowHook(() => useWorkflowRefreshDraft(), {
      hooksStoreProps: { handleRefreshWorkflowDraft },
    })

    expect(result.current.handleRefreshWorkflowDraft).toBe(handleRefreshWorkflowDraft)
  })
})
