import { screen, within } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowAppSaveStatus } from '../save-status'

it('should show unsaved changes instead of the previous autosave time after a conflict', () => {
  renderWorkflowComponent(<WorkflowAppSaveStatus />, {
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
