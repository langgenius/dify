import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import BatchAction from './batch-action'

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
    await screen.findByText('appAnnotation.list.delete.title')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1])
    })

    await waitFor(() => {
      expect(onBatchDelete).toHaveBeenCalledTimes(1)
    })
  })
})
