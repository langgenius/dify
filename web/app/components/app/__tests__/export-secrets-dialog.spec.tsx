import { AlertDialog } from '@langgenius/dify-ui/alert-dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportSecretsDialogContent } from '@/app/components/app/export-secrets-dialog'
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

function renderDialog({ isExporting = false } = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()

  render(
    <AlertDialog
      open
      onOpenChange={(open, details) => {
        if (!open && isExporting) details.cancel()
        else onOpenChange(open)
      }}
    >
      <ExportSecretsDialogContent
        envList={envList}
        isExporting={isExporting}
        onConfirm={onConfirm}
      />
    </AlertDialog>,
  )

  return { onConfirm, onOpenChange }
}

describe('ExportSecretsDialogContent', () => {
  it('renders environment rows and closes through the cancel button', async () => {
    const user = userEvent.setup()
    const { onConfirm, onOpenChange } = renderDialog()

    expect(screen.getByText('SECRET_TOKEN')).toBeInTheDocument()
    expect(screen.getByText('masked-value')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms without secrets by default', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'app.exportApp' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('confirms with secrets after toggling the checkbox', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog()

    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'app.exportSecret.description',
    )
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('blocks confirmation while the export request is pending', async () => {
    const user = userEvent.setup()
    const { onConfirm, onOpenChange } = renderDialog({ isExporting: true })

    const confirmButton = screen.getByRole('button', { name: 'common.operation.exporting' })
    expectLoadingButton(confirmButton)
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.click(confirmButton)
    await user.keyboard('{Escape}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
