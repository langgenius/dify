import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import VariableModal from '../variable-modal'

vi.mock('@/app/notifications', () => ({
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

const renderWithProviders = createNuqsTestRenderer(
  (
    ui: ReactElement,
    options: {
      storeState?: Partial<Shape>
    } = {},
  ) => {
    const store = createWorkflowStore({})

    if (options.storeState) store.setState(options.storeState)

    const queryClient = createConsoleQueryClient()
    seedModelProviderQueries(queryClient, [
      createModelCatalogFixture({
        models: [
          createCatalogModelFixture({
            model: 'chat-model',
            label: { en_US: 'chat-model' },
            model_properties: { mode: 'chat' },
          }),
          createCatalogModelFixture({
            model: 'completion-model',
            label: { en_US: 'completion-model' },
            model_properties: { mode: 'completion' },
          }),
        ],
      }),
    ])
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      {
        initialData: {
          data: [
            {
              name: 'temperature',
              label: { en_US: 'Temperature' },
              type: 'float',
              default: 0.7,
              min: 0,
              max: 2,
            },
          ],
        },
      },
    )
    const result = renderWithConsoleQuery(<WorkflowContext value={store}>{ui}</WorkflowContext>, {
      queryClient,
    })

    return {
      ...result,
      store,
    }
  },
)

describe('VariableModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes from an accessible icon button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<VariableModal onClose={onClose} onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('creates a secret environment variable and normalizes spaces in its name', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(<VariableModal onClose={onClose} onSave={onSave} />, {
      storeState: {
        environmentVariables: [],
      },
    })

    await user.click(screen.getByText('Secret'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'my secret')
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'),
      'top-secret',
    )
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.descriptionPlaceholder'),
      'runtime only',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder')).toHaveValue(
      'my_secret',
    )
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
    const onSave = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<VariableModal onClose={onClose} onSave={onSave} />, {
      storeState: {
        environmentVariables: [
          createEnv({ id: 'env-existing', name: 'duplicated', value_type: 'string', value: '1' }),
        ],
      },
    })

    await user.click(screen.getByRole('textbox', { name: 'workflow.env.modal.name' }))
    await user.paste('1bad')
    expect(mockToastError).toHaveBeenCalled()

    mockToastError.mockClear()
    await user.clear(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'duplicated')
    await user.type(screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'), '42')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockToastError).toHaveBeenCalledWith(
      'appDebug.varKeyError.keyAlreadyExists:{"key":"workflow.env.modal.name"}',
    )
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
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

  it('creates an LLM environment variable from the selected text-generation model', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    renderWithProviders(<VariableModal onClose={vi.fn()} onSave={onSave} />, {
      storeState: {
        environmentVariables: [],
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.blocks.llm' }))
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'),
      'for_summarize',
    )
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    const picker = within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    )
    await user.click(picker.getByRole('button', { name: /^chat-model/ }))
    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' })
    await user.clear(temperature)
    await user.type(temperature, '0.4')
    await user.tab()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'for_summarize',
      value: {
        provider: 'openai',
        name: 'chat-model',
        mode: 'chat',
        completion_params: { temperature: 0.4 },
      },
      value_type: 'llm',
      description: '',
    })
  })

  it('rejects an LLM environment variable with an empty model selection', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const env = createEnv({
      value: { mode: '', name: '', provider: '' },
      value_type: 'llm',
    })

    renderWithProviders(<VariableModal env={env} onClose={vi.fn()} onSave={onSave} />, {
      storeState: {
        environmentVariables: [env],
      },
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockToastError).toHaveBeenCalledWith('workflow.env.modal.valueRequired')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps an edited LLM environment variable within its existing model mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const env = createEnv({
      id: 'env-llm',
      name: 'for_research',
      value: { provider: 'openai', name: 'chat-model', mode: 'chat' },
      value_type: 'llm',
      description: 'research model',
    })

    renderWithProviders(<VariableModal env={env} onClose={vi.fn()} onSave={onSave} />, {
      storeState: {
        environmentVariables: [env],
      },
    })

    expect(screen.getByRole('button', { name: 'String' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Number' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Secret', pressed: false })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workflow.blocks.llm' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /^chat-model/ }))
    const picker = within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    )
    expect(picker.getByRole('button', { name: /^chat-model/ })).toBeInTheDocument()
    expect(picker.queryByRole('button', { name: /^completion-model/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith(env)
  })
})
