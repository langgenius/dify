import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import EditingTitle from '../editing-title'

const mockFormatTime = vi.fn()
const mockFormatTimeFromNow = vi.fn()

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

describe('EditingTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFormatTime.mockReturnValue('08:00:00')
    mockFormatTimeFromNow.mockReturnValue('2 hours ago')
  })

  it('should render autosave, published time, and syncing status when the draft has metadata', () => {
    const { container } = renderWorkflowComponent(<EditingTitle />, {
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        publishedAt: 1_710_003_600_000,
        isSyncingWorkflowDraft: true,
        maximizeCanvas: true,
      },
    })

    expect(mockFormatTime).toHaveBeenCalledWith(1_710_000_000, 'HH:mm:ss')
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1_710_003_600_000)
    expect(container.firstChild).toHaveClass('ml-2')
    expect(container).toHaveTextContent('workflow.common.autoSaved')
    expect(container).toHaveTextContent('08:00:00')
    expect(container).toHaveTextContent('workflow.common.published')
    expect(container).toHaveTextContent('2 hours ago')
    expect(container).toHaveTextContent('workflow.common.syncingData')
  })

  it('should render unpublished status without autosave metadata when the workflow has not been published', () => {
    const { container } = renderWorkflowComponent(<EditingTitle />, {
      initialStoreState: {
        draftUpdatedAt: 0,
        publishedAt: 0,
        isSyncingWorkflowDraft: false,
        maximizeCanvas: false,
      },
    })

    expect(mockFormatTime).not.toHaveBeenCalled()
    expect(mockFormatTimeFromNow).not.toHaveBeenCalled()
    expect(container.firstChild).not.toHaveClass('ml-2')
    expect(container).toHaveTextContent('workflow.common.unpublished')
    expect(container).not.toHaveTextContent('workflow.common.autoSaved')
    expect(container).not.toHaveTextContent('workflow.common.syncingData')
  })
})
