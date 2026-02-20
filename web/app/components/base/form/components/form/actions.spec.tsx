import type { FormType } from '../..'
import type { CustomActionsProps } from './actions'
import { fireEvent, render, screen } from '@testing-library/react'
import { formContext } from '../..'
import Actions from './actions'

const renderWithForm = ({
  canSubmit,
  isSubmitting,
  CustomActions,
}: {
  canSubmit: boolean
  isSubmitting: boolean
  CustomActions?: (props: CustomActionsProps) => React.ReactNode
}) => {
  const submitSpy = vi.fn()
  const state = {
    canSubmit,
    isSubmitting,
  }
  const form = {
    store: {
      state,
      subscribe: () => () => {},
    },
    handleSubmit: submitSpy,
  }

  const TestComponent = () => {
    return (
      <formContext.Provider value={form as unknown as FormType}>
        <Actions
          CustomActions={CustomActions}
        />
      </formContext.Provider>
    )
  }

  render(<TestComponent />)
  return { submitSpy }
}

describe('Actions', () => {
  it('should disable submit button when form cannot submit', () => {
    renderWithForm({ canSubmit: false, isSubmitting: false })
    expect(screen.getByRole('button', { name: 'common.operation.submit' })).toBeDisabled()
  })

  it('should call form submit when users click submit button', () => {
    const { submitSpy } = renderWithForm({ canSubmit: true, isSubmitting: false })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.submit' }))
    expect(submitSpy).toHaveBeenCalled()
  })

  it('should render custom actions when provided', () => {
    renderWithForm({
      canSubmit: true,
      isSubmitting: true,
      CustomActions: ({ isSubmitting, canSubmit }) => (
        <div>
          {`custom-${String(isSubmitting)}-${String(canSubmit)}`}
        </div>
      ),
    })

    expect(screen.queryByRole('button', { name: 'common.operation.submit' })).not.toBeInTheDocument()
    expect(screen.getByText('custom-true-true')).toBeInTheDocument()
  })
})
