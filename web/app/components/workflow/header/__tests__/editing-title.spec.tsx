import { screen, within } from '@testing-library/react'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import EditingTitle from '../editing-title'

describe('EditingTitle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2024-03-09T19:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('should render autosave, published time, and syncing status when the draft has metadata', () => {
    renderWorkflowComponent(<EditingTitle />, {
      queryClient: createAccountProfileQueryClient({ timezone: 'UTC' }),
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        publishedAt: 1_710_003_600_000,
        isSyncingWorkflowDraft: true,
      },
    })

    const saveStatus = screen.getByRole('status', {
      name: 'workflow.common.workflowSaveStatus',
    })
    const statusContent = within(saveStatus)

    expect(statusContent.getByText('workflow.common.autoSaved')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.published')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.syncingData')).toBeInTheDocument()

    const draftUpdatedTime = statusContent.getByText('16:00:00')
    const publishedTime = statusContent.getByText('2 hours ago')
    expect(draftUpdatedTime).toHaveAttribute('datetime', '2024-03-09T16:00:00.000Z')
    expect(publishedTime).toHaveAttribute('datetime', '2024-03-09T17:00:00.000Z')
  })

  it('should expose autosave time separately from the unpublished status', () => {
    renderWorkflowComponent(<EditingTitle />, {
      queryClient: createAccountProfileQueryClient({ timezone: 'UTC' }),
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        publishedAt: 0,
        isSyncingWorkflowDraft: false,
      },
    })

    const saveStatus = screen.getByRole('status', {
      name: 'workflow.common.workflowSaveStatus',
    })
    const statusContent = within(saveStatus)

    expect(statusContent.getByText('workflow.common.autoSaved')).toBeInTheDocument()
    expect(statusContent.getByText('workflow.common.unpublished')).toBeInTheDocument()
    expect(statusContent.queryByText('workflow.common.syncingData')).not.toBeInTheDocument()
  })

  it('should show unsaved changes instead of the previous autosave time after a conflict', () => {
    renderWorkflowComponent(<EditingTitle />, {
      initialStoreState: {
        draftUpdatedAt: 1_710_000_000_000,
        hasWorkflowDraftConflict: true,
      },
    })

    const status = screen.getByRole('status', { name: 'workflow.common.workflowSaveStatus' })
    expect(within(status).getByText('workflow.draftConflict.unsaved')).toBeInTheDocument()
    expect(within(status).queryByText('workflow.common.autoSaved')).not.toBeInTheDocument()
    expect(within(status).queryByText('08:00:00')).not.toBeInTheDocument()
  })
})
