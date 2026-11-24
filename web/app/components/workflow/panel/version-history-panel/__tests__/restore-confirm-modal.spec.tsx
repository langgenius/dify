import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import RestoreConfirmModal from '../restore-confirm-modal'

const createVersionInfo = (overrides: Partial<WorkflowResponse> = {}) =>
  createWorkflowResponseFixture({
    id: 'version-1',
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
    version: '1',
    marked_name: 'Release 1',
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
