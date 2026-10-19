import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RestoreConfirmModal from '../restore-confirm-modal'

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

describe('RestoreConfirmModal', () => {
  it('restores the named version after confirmation', async () => {
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

    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

    expect(onRestore).toHaveBeenCalledWith(versionInfo, expect.anything())
  })

  it('identifies an unnamed version by number and cancels without restoring it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRestore = vi.fn()
    render(
      <RestoreConfirmModal
        isOpen
        versionInfo={createVersionInfo({ marked_name: '', version_number: 5 })}
        onClose={onClose}
        onRestore={onRestore}
      />,
    )

    expect(screen.getByText('workflow.common.restore # 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onRestore).not.toHaveBeenCalled()
  })
})
