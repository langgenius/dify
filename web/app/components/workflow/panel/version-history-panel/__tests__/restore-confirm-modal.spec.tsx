import type { VersionHistory } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RestoreConfirmModal from '../restore-confirm-modal'

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

describe('RestoreConfirmModal', () => {
  it('renders the version name and triggers restore and close actions', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRestore = vi.fn()
    const versionInfo = createVersionInfo()

    render(
      <RestoreConfirmModal
        isOpen
        versionInfo={versionInfo}
        onClose={onClose}
        onRestore={onRestore}
      />,
    )

    expect(screen.getByText('workflow.common.restore Release 1')).toBeInTheDocument()

    await user.click(screen.getByText('common.operation.cancel'))
    await user.click(screen.getByText('workflow.common.restore'))

    expect(onClose).toHaveBeenCalled()
    expect(onRestore).toHaveBeenCalledWith(versionInfo, expect.anything())
  })
})
