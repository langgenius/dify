import { screen, within } from '@testing-library/react'
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
    renderWorkflowComponent(<EditingTitle />, {
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        publishedAt: 1_710_003_600_000,
        isSyncingWorkflowDraft: true,
      },
    })

    expect(mockFormatTime).toHaveBeenCalledWith(1_710_000_000, 'HH:mm:ss')
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1_710_003_600_000)
    const saveStatus = screen.getByRole('status', {
      name: 'workflow.common.workflowSaveStatus',
    })
    const statusContent = within(saveStatus)

    expect(statusContent.getByText('workflow.common.autoSaved')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.published')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.syncingData')).toBeInTheDocument()

    const draftUpdatedTime = statusContent.getByText('08:00:00')
    const publishedTime = statusContent.getByText('2 hours ago')
    expect(draftUpdatedTime.tagName).toBe('TIME')
    expect(draftUpdatedTime).toHaveTextContent('08:00:00')
    expect(draftUpdatedTime).toHaveAttribute('datetime', '2024-03-09T16:00:00.000Z')
    expect(publishedTime.tagName).toBe('TIME')
    expect(publishedTime).toHaveTextContent('2 hours ago')
    expect(publishedTime).toHaveAttribute('datetime', '2024-03-09T17:00:00.000Z')
  })

  it('should expose autosave time separately from the unpublished status', () => {
    renderWorkflowComponent(<EditingTitle />, {
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        publishedAt: 0,
        isSyncingWorkflowDraft: false,
      },
    })

    expect(mockFormatTime).toHaveBeenCalledWith(1_710_000_000, 'HH:mm:ss')
    expect(mockFormatTimeFromNow).not.toHaveBeenCalled()
    const saveStatus = screen.getByRole('status', {
      name: 'workflow.common.workflowSaveStatus',
    })
    const statusContent = within(saveStatus)

    expect(statusContent.getByText('workflow.common.autoSaved')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.unpublished')).toBeInTheDocument()
    expect(statusContent.queryByText('workflow.common.syncingData')).not.toBeInTheDocument()
    expect(statusContent.getByText('08:00:00').tagName).toBe('TIME')
  })
})
