import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteConfirmModal from '../delete-confirm-modal'

const createVersionInfo = (
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
  },
  features: {},
  hash: 'hash-1',
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  updated_at: 1710000000,
  updated_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  version: '1',
  marked_name: 'Release 1',
  marked_comment: '',
  ...overrides,
})

describe('DeleteConfirmModal', () => {
  it('deletes the named version after confirmation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDelete = vi.fn()

    render(
      <DeleteConfirmModal
        isOpen
        versionInfo={createVersionInfo()}
        onClose={onClose}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByText('common.operation.delete Release 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    expect(onDelete).toHaveBeenCalledWith('version-1', expect.anything())
  })

  it('cancels deleting a legacy version identified by its default name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDelete = vi.fn()
    render(
      <DeleteConfirmModal
        isOpen
        versionInfo={createVersionInfo({ marked_name: '', version_number: null })}
        onClose={onClose}
        onDelete={onDelete}
      />,
    )

    expect(
      screen.getByText('common.operation.delete workflowHistory.versionHistory.defaultName'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
