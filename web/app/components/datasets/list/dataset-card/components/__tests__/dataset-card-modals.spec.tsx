import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import DatasetCardModals from '../dataset-card-modals'

describe('DatasetCardModals', () => {
  it.each(['confirm', 'cancel'] as const)('requires the user to %s deletion', async (action) => {
    const user = userEvent.setup()
    const onConfirmDelete = vi.fn()
    const onCloseConfirm = vi.fn()
    render(
      <DatasetCardModals
        dataset={createDatasetFixture()}
        modalState={{
          showRenameModal: false,
          showConfirmDelete: true,
          showAccessConfig: false,
          confirmMessage: 'Delete Product knowledge and all its documents?',
        }}
        onConfirmDelete={onConfirmDelete}
        onCloseConfirm={onCloseConfirm}
        onCloseRename={vi.fn()}
        onCloseAccessConfig={vi.fn()}
      />,
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'dataset.deleteDatasetConfirmTitle',
    })
    expect(dialog).toHaveTextContent('Delete Product knowledge and all its documents?')
    expect(onConfirmDelete).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: `common.operation.${action}` }))
    if (action === 'confirm') expect(onConfirmDelete).toHaveBeenCalledOnce()
    else {
      expect(onConfirmDelete).not.toHaveBeenCalled()
      expect(onCloseConfirm).toHaveBeenCalledOnce()
    }
  })
})
