import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import RunningTitle from '../running-title'

let mockIsChatMode = false
const mockFormatWorkflowRunIdentifier = vi.fn()

vi.mock('../../hooks', () => ({
  useIsChatMode: () => mockIsChatMode,
}))

vi.mock('../../utils', () => ({
  formatWorkflowRunIdentifier: (finishedAt?: number) => mockFormatWorkflowRunIdentifier(finishedAt),
}))

describe('RunningTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = false
    mockFormatWorkflowRunIdentifier.mockReturnValue(' (14:30:25)')
  })

  it('should render the test run title in workflow mode', () => {
    const { container } = renderWorkflowComponent(<RunningTitle />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'history-1',
          status: 'succeeded',
          finished_at: 1_700_000_000,
        },
      },
    })

    expect(mockFormatWorkflowRunIdentifier).toHaveBeenCalledWith(1_700_000_000)
    expect(container).toHaveTextContent('Test Run (14:30:25)')
    expect(container).toHaveTextContent('workflow.common.viewOnly')
  })

  it('should render the test chat title in chat mode', () => {
    mockIsChatMode = true

    const { container } = renderWorkflowComponent(<RunningTitle />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'history-2',
          status: 'running',
          finished_at: undefined,
        },
      },
    })

    expect(mockFormatWorkflowRunIdentifier).toHaveBeenCalledWith(undefined)
    expect(container).toHaveTextContent('Test Chat (14:30:25)')
  })

  it('should handle missing workflow history data', () => {
    const { container } = renderWorkflowComponent(<RunningTitle />)

    expect(mockFormatWorkflowRunIdentifier).toHaveBeenCalledWith(undefined)
    expect(container).toHaveTextContent('Test Run (14:30:25)')
  })
})
