import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
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

  if (options.storeState) store.setState(options.storeState)

  const result = render(<WorkflowContext value={store}>{ui}</WorkflowContext>)

  return {
    ...result,
    store,
  }
}

describe('EnvItem', () => {
  it('lets keyboard users edit and delete the identified variable', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    renderWithProviders(<EnvItem env={env} onEdit={onEdit} onDelete={onDelete} />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.edit api_key' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledWith(env)
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.delete api_key' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onDelete).toHaveBeenCalledWith(env)
  })

  it('renders the model name for an LLM environment variable', () => {
    const env = createEnv({
      id: 'env-llm',
      name: 'for_summarize',
      value: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
      value_type: 'llm',
      description: '',
    })

    renderWithProviders(<EnvItem env={env} onEdit={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('for_summarize')).toBeInTheDocument()
    expect(screen.getByText('workflow.blocks.llm')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
  })
})
