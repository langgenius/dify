import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BatchAction from '../batch-action'

describe('BatchAction', () => {
  const baseProps = {
    selectedIds: ['1', '2', '3'],
    onBatchDelete: vi.fn(),
    onSelectedIdsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the selected count and clear selection through selection change', async () => {
    const user = userEvent.setup()
    render(<BatchAction {...baseProps} className="custom-class" />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('appAnnotation.batchAction.selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(baseProps.onSelectedIdsChange).toHaveBeenCalledWith([])
  })

  it('should confirm before running batch delete', async () => {
    const user = userEvent.setup()
    const onBatchDelete = vi.fn().mockResolvedValue(undefined)
    render(<BatchAction {...baseProps} onBatchDelete={onBatchDelete} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('appAnnotation.list.delete.title')).toBeInTheDocument()
    expect(onBatchDelete).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(onBatchDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('should hide delete confirmation when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onBatchDelete = vi.fn()
    render(<BatchAction {...baseProps} onBatchDelete={onBatchDelete} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(onBatchDelete).not.toHaveBeenCalled()
  })

  it('should keep the delete confirmation open when batch delete fails', async () => {
    const user = userEvent.setup()
    const onBatchDelete = vi.fn().mockRejectedValue(new Error('failed'))
    render(<BatchAction {...baseProps} onBatchDelete={onBatchDelete} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(onBatchDelete).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeEnabled()
    })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
