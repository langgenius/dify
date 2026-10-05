import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { ConfirmModal } from '../index'

describe('ConfirmModal', () => {
  it('does not expose the dialog while hidden', () => {
    render(<ConfirmModal open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['common.operation.close', 'close button'],
    ['common.operation.cancel', 'cancel button'],
  ])('closes from the %s action', async (name) => {
    const onOpenChange = vi.fn()
    render(<ConfirmModal open onOpenChange={onOpenChange} />)

    await userEvent.click(screen.getByRole('button', { name }))

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })

  it('confirms the destructive update', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmModal open onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('tools.createTool.confirmTip')
  })
})
