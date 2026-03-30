import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModalFoot from '../modal-foot'

describe('ModalFoot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render cancel and save actions', () => {
    render(<ModalFoot onCancel={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
  })

  it('should trigger callbacks when action buttons are clicked', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(<ModalFoot onCancel={onCancel} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
