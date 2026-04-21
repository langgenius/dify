import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import EnvItem from '../env-item'

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

describe('EnvItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders secret env items and triggers edit and delete actions', async () => {
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

  it('renders non-secret env values and clears destructive styling on mouse out', () => {
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
})
