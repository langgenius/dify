import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DSLExportConfirmModal from '../dsl-export-confirm-modal'

const envList = [
  {
    id: 'env-1',
    name: 'SECRET_TOKEN',
    value: 'masked-value',
    value_type: 'secret' as const,
    description: 'secret token',
  },
]

const multiEnvList = [
  ...envList,
  {
    id: 'env-2',
    name: 'SERVICE_KEY',
    value: 'another-secret',
    value_type: 'secret' as const,
    description: 'service key',
  },
]

describe('DSLExportConfirmModal', () => {
  it('should render environment rows and close when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DSLExportConfirmModal
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
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DSLExportConfirmModal
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.env.export.ignore' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should confirm with exportSecrets=true after toggling the checkbox', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DSLExportConfirmModal
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'workflow.env.export.export' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should also toggle exportSecrets when the label text is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DSLExportConfirmModal
        envList={envList}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByText('workflow.env.export.checkbox'))
    await user.click(screen.getByRole('button', { name: 'workflow.env.export.export' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should render border separators for all rows except the last one', () => {
    render(
      <DSLExportConfirmModal
        envList={multiEnvList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const firstNameCell = screen.getByText('SECRET_TOKEN').closest('td')
    const lastNameCell = screen.getByText('SERVICE_KEY').closest('td')
    const firstValueCell = screen.getByText('masked-value').closest('td')
    const lastValueCell = screen.getByText('another-secret').closest('td')

    expect(firstNameCell).toHaveClass('border-b')
    expect(firstValueCell).toHaveClass('border-b')
    expect(lastNameCell).not.toHaveClass('border-b')
    expect(lastValueCell).not.toHaveClass('border-b')
  })
})
