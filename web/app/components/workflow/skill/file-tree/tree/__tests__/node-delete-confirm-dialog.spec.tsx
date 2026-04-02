import { fireEvent, render, screen } from '@testing-library/react'
import NodeDeleteConfirmDialog from '../node-delete-confirm-dialog'

describe('NodeDeleteConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the file deletion copy and call confirm/cancel handlers', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <NodeDeleteConfirmDialog
        nodeType="file"
        open
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmTitle')).toBeInTheDocument()
    expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmContent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should render the folder deletion copy and disable confirm while deleting', () => {
    render(
      <NodeDeleteConfirmDialog
        nodeType="folder"
        open
        isDeleting
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.skillSidebar.menu.deleteConfirmTitle')).toBeInTheDocument()
    expect(screen.getByText('workflow.skillSidebar.menu.deleteConfirmContent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /common\.operation\.confirm/i })).toBeDisabled()
  })
})
