import type { ZodSchema } from 'zod'
import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Options from '../options'

const {
  mockFormValue,
  mockHandleSubmit,
  mockToastError,
  mockBaseField,
} = vi.hoisted(() => ({
  mockFormValue: { chunkSize: 256 } as Record<string, unknown>,
  mockHandleSubmit: vi.fn(),
  mockToastError: vi.fn(),
  mockBaseField: vi.fn(({ config }: { config: { variable: string } }) => {
    return function FieldComponent() {
      return <div data-testid="base-field">{config.variable}</div>
    }
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/base/form/form-scenarios/base/field', () => ({
  default: mockBaseField,
}))

vi.mock('@/app/components/base/form', () => ({
  useAppForm: ({
    onSubmit,
    validators,
  }: {
    onSubmit: (params: { value: Record<string, unknown> }) => void
    validators?: {
      onSubmit?: (params: { value: Record<string, unknown> }) => string | undefined
    }
  }) => ({
    handleSubmit: () => {
      const validationResult = validators?.onSubmit?.({ value: mockFormValue })
      if (!validationResult)
        onSubmit({ value: mockFormValue })
      mockHandleSubmit()
    },
    AppForm: ({ children }: { children: React.ReactNode }) => <div data-testid="app-form">{children}</div>,
    Actions: ({ CustomActions }: { CustomActions: (props: CustomActionsProps) => React.ReactNode }) => (
      <div data-testid="form-actions">
        {CustomActions({
          form: {
            handleSubmit: mockHandleSubmit,
          } as unknown as CustomActionsProps['form'],
          isSubmitting: false,
          canSubmit: true,
        })}
      </div>
    ),
  }),
}))

const createSchema = (success: boolean): ZodSchema => ({
  safeParse: vi.fn(() => {
    if (success)
      return { success: true }

    return {
      success: false,
      error: {
        issues: [{
          path: ['chunkSize'],
          message: 'Invalid value',
        }],
      },
    }
  }),
}) as unknown as ZodSchema

describe('Document processing options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render base fields and the custom actions slot', () => {
    render(
      <Options
        initialData={{ chunkSize: 100 }}
        configurations={[{ variable: 'chunkSize' } as BaseConfiguration]}
        schema={createSchema(true)}
        CustomActions={() => <div data-testid="custom-actions">custom actions</div>}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByTestId('base-field')).toHaveTextContent('chunkSize')
    expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    expect(screen.getByTestId('custom-actions')).toBeInTheDocument()
  })

  it('should validate and toast the first schema error before submitting', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <Options
        initialData={{ chunkSize: 100 }}
        configurations={[]}
        schema={createSchema(false)}
        CustomActions={() => <div>actions</div>}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Path: chunkSize Error: Invalid value')
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('should submit the parsed form value when validation succeeds', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <Options
        initialData={{ chunkSize: 100 }}
        configurations={[]}
        schema={createSchema(true)}
        CustomActions={() => <div>actions</div>}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(mockFormValue)
    })
  })
})
