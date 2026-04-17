import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/components/base/ui/toast'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import VariableModal from '../variable-modal'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const mockToastError = vi.mocked(toast.error)

const createEnv = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'api_key',
  value: '[__HIDDEN__]',
  value_type: 'secret',
  description: 'secret description',
  ...overrides,
})

const renderWithProviders = (
  ui: ReactElement,
  options: {
    storeState?: Partial<Shape>
  } = {},
) => {
  const store = createWorkflowStore({})

  if (options.storeState)
    store.setState(options.storeState)

  const result = render(
    <WorkflowContext value={store}>
      {ui}
    </WorkflowContext>,
  )

  return {
    ...result,
    store,
  }
}

describe('VariableModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a secret environment variable and normalizes spaces in its name', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <VariableModal onClose={onClose} onSave={onSave} />,
      {
        storeState: {
          environmentVariables: [],
        },
      },
    )

    await user.click(screen.getByText('Secret'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'my secret')
    await user.type(screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'), 'top-secret')
    await user.type(screen.getByPlaceholderText('workflow.env.modal.descriptionPlaceholder'), 'runtime only')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder')).toHaveValue('my_secret')
    expect(onSave).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'my_secret',
      value: 'top-secret',
      value_type: 'secret',
      description: 'runtime only',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid and duplicate variable names', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VariableModal onClose={vi.fn()} onSave={vi.fn()} />,
      {
        storeState: {
          environmentVariables: [createEnv({ id: 'env-existing', name: 'duplicated', value_type: 'string', value: '1' })],
        },
      },
    )

    fireEvent.change(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), {
      target: { value: '1bad' },
    })
    expect(mockToastError).toHaveBeenCalled()

    mockToastError.mockClear()
    await user.clear(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'duplicated')
    await user.type(screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'), '42')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockToastError).toHaveBeenCalledWith('appDebug.varKeyError.keyAlreadyExists:{"key":"workflow.env.modal.name"}')
  })

  it('loads existing secret values and converts them to numbers when editing', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    renderWithProviders(
      <VariableModal
        env={createEnv({
          id: 'env-2',
          name: 'counter',
          value: '[__HIDDEN__]',
          description: 'editable',
        })}
        onClose={vi.fn()}
        onSave={onSave}
      />,
      {
        storeState: {
          environmentVariables: [createEnv({ id: 'env-2', name: 'counter' })],
          envSecrets: { 'env-2': '123' },
        },
      },
    )

    expect(screen.getByDisplayValue('counter')).toBeInTheDocument()
    expect(screen.getByDisplayValue('123')).toBeInTheDocument()

    await user.click(screen.getByText('Number'))
    const valueInput = screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder')
    await user.clear(valueInput)
    await user.type(valueInput, '9')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'env-2',
      name: 'counter',
      value: 9,
      value_type: 'number',
      description: 'editable',
    })
  })
})
