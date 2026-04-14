import { fireEvent, render, screen } from '@testing-library/react'
import ModalFoot from '../modal-foot'

describe('ModalFoot', () => {
  it('should trigger cancel and confirm callbacks', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(
      <ModalFoot onCancel={onCancel} onConfirm={onConfirm} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
