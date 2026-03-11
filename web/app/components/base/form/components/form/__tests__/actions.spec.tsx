import type { FormType } from '../../..'
import type { CustomActionsProps } from '../actions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formContext } from '../../..'
import Actions from '../actions'

const mockFormState = vi.hoisted(() => ({
  canSubmit: true,
  isSubmitting: false,
}))

vi.mock('@tanstack/react-form', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-form')>('@tanstack/react-form')
  return {
    ...actual,
    useStore: (_store: unknown, selector: (state: typeof mockFormState) => unknown) => selector(mockFormState),
  }
})

type RenderWithFormOptions = {
  canSubmit?: boolean
  isSubmitting?: boolean
  CustomActions?: (props: CustomActionsProps) => React.ReactNode
  onSubmit?: () => void
}

const renderWithForm = ({
  canSubmit = true,
  isSubmitting = false,
  CustomActions,
  onSubmit = vi.fn(),
}: RenderWithFormOptions = {}) => {
  mockFormState.canSubmit = canSubmit
  mockFormState.isSubmitting = isSubmitting

  const form = {
    store: {},
    handleSubmit: onSubmit,
  }

  render(
    <formContext.Provider value={form as unknown as FormType}>
      <Actions CustomActions={CustomActions} />
    </formContext.Provider>,
  )

  return { onSubmit }
}

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should disable submit button when form cannot submit', () => {
    renderWithForm({ canSubmit: false })
    expect(screen.getByRole('button', { name: 'common.operation.submit' })).toBeDisabled()
  })

  it('should call form submit when users click submit button', async () => {
    const submitSpy = vi.fn()
    renderWithForm({ onSubmit: submitSpy })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('should render custom actions when provided', () => {
    const customActionsSpy = vi.fn(({ isSubmitting, canSubmit }: CustomActionsProps) => (
      <div>
        {`custom-${String(isSubmitting)}-${String(canSubmit)}`}
      </div>
    ))

    renderWithForm({
      CustomActions: customActionsSpy,
    })

    expect(screen.queryByRole('button', { name: 'common.operation.submit' })).not.toBeInTheDocument()
    expect(screen.getByText('custom-false-true')).toBeInTheDocument()
    expect(customActionsSpy).toHaveBeenCalledWith(expect.objectContaining({
      form: expect.any(Object),
      isSubmitting: false,
      canSubmit: true,
    }))
  })
})
