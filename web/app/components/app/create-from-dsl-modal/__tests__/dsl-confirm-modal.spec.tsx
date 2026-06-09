import { fireEvent, render, screen } from '@testing-library/react'
import DSLConfirmModal from '../dsl-confirm-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('DSLConfirmModal', () => {
  it('should render the version details', () => {
    render(
      <DSLConfirmModal
        versions={{
          importedVersion: '1.0.0',
          systemVersion: '2.0.0',
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
  })

  it('should call the cancel and confirm handlers', () => {
    const handleCancel = vi.fn()
    const handleConfirm = vi.fn()

    render(
      <DSLConfirmModal
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'newApp.Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'newApp.Confirm' }))

    expect(handleCancel).toHaveBeenCalledTimes(1)
    expect(handleConfirm).toHaveBeenCalledTimes(1)
  })
})
