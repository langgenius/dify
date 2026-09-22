import { render, screen, waitFor } from '@testing-library/react'
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
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(<AppExportConfirmModal envList={envList} onConfirm={onConfirm} onClose={onClose} />)

    expect(screen.getByText('SECRET_TOKEN')).toBeInTheDocument()
    expect(screen.getByText('masked-value')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should confirm with exportSecrets=false by default', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(<AppExportConfirmModal envList={envList} onConfirm={onConfirm} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'app.exportApp' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should confirm with exportSecrets=true after toggling the checkbox', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(<AppExportConfirmModal envList={envList} onConfirm={onConfirm} onClose={onClose} />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should also toggle exportSecrets when the label text is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(<AppExportConfirmModal envList={envList} onConfirm={onConfirm} onClose={onClose} />)

    await user.click(screen.getByText('workflow.env.export.checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should show exporting state and prevent duplicate submits while exporting', async () => {
    let resolveConfirm: () => void
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        }),
    )
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<AppExportConfirmModal envList={envList} onConfirm={onConfirm} onClose={onClose} />)

    const confirmButton = screen.getByRole('button', { name: 'app.exportApp' })

    const firstClick = user.click(confirmButton)
    await waitFor(() => {
      expectLoadingButton(confirmButton)
      expect(confirmButton).toHaveTextContent('common.operation.exporting')
      expect(confirmButton).toHaveAccessibleName('common.operation.exporting')
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    })

    await user.click(confirmButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    resolveConfirm!()
    await firstClick

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('explains that secret values are included in the app package', () => {
    render(<AppExportConfirmModal envList={envList} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'app.exportSecret.description',
    )
  })
})
