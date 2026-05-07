import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import BatchAction from '../batch-action'

describe('BatchAction', () => {
  const baseProps = {
    selectedIds: ['1', '2', '3'],
    onBatchDelete: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the selected count and trigger cancel action', () => {
    render(<BatchAction {...baseProps} className="custom-class" />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('appAnnotation.batchAction.selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should confirm before running batch delete', async () => {
    const onBatchDelete = vi.fn().mockResolvedValue(undefined)
    render(<BatchAction {...baseProps} onBatchDelete={onBatchDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('appAnnotation.list.delete.title')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(onBatchDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('should hide delete confirmation when cancel is clicked', async () => {
    const onBatchDelete = vi.fn()
    render(<BatchAction {...baseProps} onBatchDelete={onBatchDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(onBatchDelete).not.toHaveBeenCalled()
  })
})
