import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an LLM environment variable without exposing its object value', () => {
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
