import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConfirmModal from '../index'

describe('ConfirmModal', () => {
  it('does not expose the dialog while hidden', () => {
    render(<ConfirmModal show={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['common.operation.close', 'close button'],
    ['common.operation.cancel', 'cancel button'],
  ])('closes from the %s action', async (name) => {
    const onClose = vi.fn()
    render(<ConfirmModal show onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('confirms the destructive update', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmModal show onClose={vi.fn()} onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
