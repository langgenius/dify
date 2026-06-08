import type { VersionHistory } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteConfirmModal from '../delete-confirm-modal'

const createVersionInfo = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
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
  it('renders the version name and triggers delete and close actions', async () => {
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

    await user.click(screen.getByText('common.operation.cancel'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(onClose).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledWith('version-1', expect.anything())
  })
})
