import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/components/base/ui/toast'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import EnvItem from '../env-item'
import VariableModal from '../variable-modal'
import VariableTrigger from '../variable-trigger'

vi.mock('uuid', () => ({
  v4: () => 'env-created',
}))

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
    <WorkflowContext.Provider value={store}>
      {ui}
    </WorkflowContext.Provider>,
  )

  return {
    ...result,
    store,
  }
}

describe('EnvPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render secret env items and trigger edit and delete actions', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const env = createEnv()

    const { container } = renderWithProviders(
      <EnvItem env={env} onEdit={onEdit} onDelete={onDelete} />,
      {
        storeState: {
          envSecrets: {
            [env.id]: 'masked-value',
          },
        },
      },
    )

    expect(screen.getByText('api_key')).toBeInTheDocument()
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(screen.getByText('masked-value')).toBeInTheDocument()
    expect(screen.getByText('secret description')).toBeInTheDocument()

    const actionWrappers = container.querySelectorAll('.cursor-pointer')
    const editIcon = actionWrappers[0]?.querySelector('svg')
    const deleteWrapper = actionWrappers[1] as HTMLElement
    const deleteIcon = deleteWrapper.querySelector('svg')

    fireEvent.mouseOver(deleteWrapper)
    expect(container.firstElementChild).toHaveClass('border-state-destructive-border')

    await user.click(editIcon as SVGElement)
    await user.click(deleteIcon as SVGElement)

    expect(onEdit).toHaveBeenCalledWith(env)
    expect(onDelete).toHaveBeenCalledWith(env)
  })

  it('should render non-secret env values and clear destructive styling on mouse out', () => {
    const env = createEnv({
      id: 'env-plain',
      name: 'public_value',
      value: 'plain-text',
      value_type: 'string',
      description: '',
    })

    const { container } = renderWithProviders(
      <EnvItem env={env} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )

    expect(screen.getByText('public_value')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
    expect(screen.getByText('plain-text')).toBeInTheDocument()
    expect(screen.queryByText('secret description')).not.toBeInTheDocument()

    const deleteWrapper = container.querySelectorAll('.cursor-pointer')[1] as HTMLElement
    fireEvent.mouseOver(deleteWrapper)
    expect(container.firstElementChild).toHaveClass('border-state-destructive-border')
    fireEvent.mouseOut(deleteWrapper)
    expect(container.firstElementChild).not.toHaveClass('border-state-destructive-border')
  })

  it('should create a secret environment variable and normalize spaces in its name', async () => {
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
      id: 'env-created',
      name: 'my_secret',
      value: 'top-secret',
      value_type: 'secret',
      description: 'runtime only',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should reject invalid and duplicate variable names', async () => {
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

  it('should load existing secret values and convert them to numbers when editing', async () => {
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

  it('should open and close the variable trigger modal with the real portal flow', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    const TriggerHarness = () => {
      const [open, setOpen] = React.useState(false)

      return (
        <VariableTrigger
          open={open}
          setOpen={setOpen}
          onClose={onClose}
          onSave={vi.fn()}
        />
      )
    }

    renderWithProviders(<TriggerHarness />)

    const trigger = screen.getByRole('button', { name: 'workflow.env.envPanelButton' })

    await user.click(trigger)
    expect(screen.getByText('workflow.env.modal.title')).toBeInTheDocument()

    await user.click(trigger)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('workflow.env.modal.title')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByText('workflow.env.modal.title')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('workflow.env.modal.title')).not.toBeInTheDocument()

    await user.click(trigger)
    const closeIcon = document.querySelector('.h-6.w-6.cursor-pointer') as HTMLElement
    await user.click(closeIcon)
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('workflow.env.modal.title')).not.toBeInTheDocument()
  })
})
