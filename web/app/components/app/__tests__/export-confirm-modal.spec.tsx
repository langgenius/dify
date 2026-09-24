import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppExportConfirmModal from '@/app/components/app/export-confirm-modal'
import { expectLoadingButton } from '@/test/button'

const envList = [
  {
    id: 'env-1',
    name: 'SECRET_TOKEN',
    value: 'masked-value',
    value_type: 'secret' as const,
    description: 'secret token',
  },
]

describe('AppExportConfirmModal', () => {
  it('should render environment rows and close when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <AppExportConfirmModal
        isExporting={false}
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('SECRET_TOKEN')).toBeInTheDocument()
    expect(screen.getByText('masked-value')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should confirm with exportSecrets=false by default', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <AppExportConfirmModal
        isExporting={false}
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'app.exportApp' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should confirm with exportSecrets=true after toggling the checkbox', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <AppExportConfirmModal
        isExporting={false}
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should also toggle exportSecrets when the label text is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <AppExportConfirmModal
        isExporting={false}
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByText('workflow.env.export.checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('blocks confirmation and dismissal while the export request is pending', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <AppExportConfirmModal
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
        isExporting
      />,
    )

    const confirmButton = screen.getByRole('button', { name: 'common.operation.exporting' })
    expectLoadingButton(confirmButton)
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.click(confirmButton)
    await user.keyboard('{Escape}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('explains that secret values are included in the app package', () => {
    render(
      <AppExportConfirmModal
        isExporting={false}
        envList={envList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'app.exportSecret.description',
    )
  })
})
