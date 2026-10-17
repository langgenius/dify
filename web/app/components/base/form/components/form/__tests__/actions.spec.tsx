import type { CustomActionsProps } from '../actions'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '../../..'

const TestForm = ({
  invalid = false,
  onSubmit = async () => {},
  CustomActions,
}: {
  invalid?: boolean
  onSubmit?: () => Promise<void>
  CustomActions?: (props: CustomActionsProps) => React.ReactNode
}) => {
  const form = useAppForm({
    defaultValues: { name: '' },
    validators: { onMount: () => (invalid ? 'Name is required' : undefined) },
    onSubmit,
  })
  return (
    <form.AppForm>
      <form.Actions CustomActions={CustomActions} />
    </form.AppForm>
  )
}

describe('Actions', () => {
  it('disables submission when the form is invalid', async () => {
    render(<TestForm invalid />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.submit' })).toBeDisabled(),
    )
  })

  it('keeps the pending button focusable and prevents duplicate submissions', async () => {
    const user = userEvent.setup()
    let finishSubmit!: () => void
    const pending = new Promise<void>((resolve) => {
      finishSubmit = resolve
    })
    const onSubmit = vi.fn(() => pending)
    render(<TestForm onSubmit={onSubmit} />)
    const button = screen.getByRole('button', { name: 'common.operation.submit' })
    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(onSubmit).toHaveBeenCalledOnce()
    await act(async () => finishSubmit())
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it('submits through the supplied form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(<TestForm onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  })

  it('provides form state to custom actions', () => {
    render(
      <TestForm
        CustomActions={({ isSubmitting, canSubmit }) => (
          <div>{`custom-${String(isSubmitting)}-${String(canSubmit)}`}</div>
        )}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'common.operation.submit' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('custom-false-true')).toBeInTheDocument()
  })
})
