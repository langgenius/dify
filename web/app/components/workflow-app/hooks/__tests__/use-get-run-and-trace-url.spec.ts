import { renderHook } from '@testing-library/react'
import { useGetRunAndTraceUrl } from '../use-get-run-and-trace-url'

const mockWorkflowStore = {
  getState: vi.fn(),
}

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockWorkflowStore,
}))

describe('useGetRunAndTraceUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.getState.mockReturnValue({
      appId: 'app-123',
    })
  })

  it('should build workflow run and trace urls from the current app id', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    expect(result.current.getWorkflowRunAndTraceUrl('run-1')).toEqual({
      runUrl: '/apps/app-123/workflow-runs/run-1',
      traceUrl: '/apps/app-123/workflow-runs/run-1/node-executions',
    })
  })
})
