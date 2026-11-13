import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VersionMismatchModal from '../version-mismatch-modal'

const versions = { importedVersion: '0.8.0', systemVersion: '1.0.0' }

it.each(['Cancel', 'Confirm'] as const)(
  'shows the version mismatch and handles %s',
  async (action) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <VersionMismatchModal isShow versions={versions} onClose={onClose} onConfirm={onConfirm} />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'app.newApp.appCreateDSLErrorTitle' })
    expect(within(dialog).getByText('0.8.0')).toBeInTheDocument()
    expect(within(dialog).getByText('1.0.0')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: `app.newApp.${action}` }))

    if (action === 'Cancel') {
      expect(onClose).toHaveBeenCalledOnce()
      expect(onConfirm).not.toHaveBeenCalled()
    } else {
      expect(onConfirm).toHaveBeenCalledOnce()
    }
  },
)

it('keeps a closed mismatch dialog out of the page', () => {
  render(
    <VersionMismatchModal
      isShow={false}
      versions={versions}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
