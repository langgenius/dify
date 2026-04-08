import { fireEvent, render, screen } from '@testing-library/react'
import ModalFoot from '../modal-foot'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

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
