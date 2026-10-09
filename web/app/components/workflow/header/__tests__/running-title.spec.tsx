import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import RunningTitle from '../running-title'

let mockIsChatMode = false

vi.mock('../../hooks/use-workflow', () => ({
  useIsChatMode: () => mockIsChatMode,
}))

describe('RunningTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = false
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

    expect(container.textContent).toMatch(/Test Run \(\d{2}:\d{2}:\d{2}( [AP]M)?\)/)
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

    expect(container).toHaveTextContent('Test Chat (Running)')
  })

  it.each([false, true])('renders paused history with chat mode %s', (isChatMode) => {
    mockIsChatMode = isChatMode

    const { container } = renderWorkflowComponent(<RunningTitle />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'history-paused',
          status: 'paused',
        },
      },
    })

    expect(container).toHaveTextContent(`Test ${isChatMode ? 'Chat' : 'Run'} (Paused)`)
  })

  it('should handle missing workflow history data', () => {
    const { container } = renderWorkflowComponent(<RunningTitle />)

    expect(container).toHaveTextContent('Test Run (Running)')
  })
})
