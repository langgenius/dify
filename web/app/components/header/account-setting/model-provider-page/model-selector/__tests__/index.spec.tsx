import type {
  ModelProviderSummaryResponse,
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { DefaultModelResponse } from '../../declarations'
import { render as renderWithoutUrlState, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { useSystemDefaultModelAndModelList } from '../../hooks'
import { ModelSelector, SplitModelSelector } from '../index'

const makeModelItem = (
  overrides: Partial<ProviderModelWithStatusEntity> = {},
): ProviderModelWithStatusEntity => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const makeModel = (
  overrides: Partial<ProviderWithModelsResponse> = {},
): ProviderWithModelsResponse => ({
  tenant_id: 'test-workspace',
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const makeProviderSummary = (): ModelProviderSummaryResponse => ({
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model'],
  preferred_provider_type: 'system',
  is_configured: true,
  custom_configuration: {
    status: 'active',
    has_custom_models: false,
    available_credentials: [],
    current_credential_usable: false,
  },
  system_configuration: { enabled: true },
})

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

const renderWithQueryClient = (node: ReactNode) => {
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: false },
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions().queryKey,
    {
      data: [makeProviderSummary()],
      plugins: {},
    },
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    remaining_credits: 100,
    quota_used: 0,
    quota_limit: 100,
    is_exhausted: false,
    is_unlimited: false,
    exhausted_at: null,
    next_credit_reset_date: null,
    pool_type: 'trial',
  })
  for (const model_type of ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: [] },
    )
  }
  return render(node, { wrapper })
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { value: { provider: 'openai', model: 'gpt-4' }, name: 'Embedding Model GPT-4' },
    { value: undefined, name: 'Embedding Model plugin.detailPanel.configureModel' },
  ])(
    'should include the visible field label and current value in its name ($name)',
    ({ value, name }) => {
      renderWithQueryClient(
        <>
          <div id="embedding-model-label">Embedding Model</div>
          <ModelSelector
            aria-labelledby="embedding-model-label"
            value={value}
            models={[makeModel()]}
          />
        </>,
      )

      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    },
  )

  it('should call onValueChange when provided', async () => {
    const onValueChange = vi.fn()
    renderWithQueryClient(<ModelSelector models={[makeModel()]} onValueChange={onValueChange} />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    await userEvent.setup().click(screen.getByRole('button', { name: /GPT-4/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onValueChange).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      plugin_id: 'langgenius/openai',
    })
  })

  it('should close popup with Escape', async () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} />)

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    await userEvent.setup().click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    await userEvent.setup().keyboard('{Escape}')
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should close popup before running the empty-state configure action', async () => {
    const onConfigureEmptyState = vi.fn()
    renderWithQueryClient(
      <ModelSelector models={[]} onConfigureEmptyState={onConfigureEmptyState} />,
    )

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    await userEvent.setup().click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'modelProvider.modelProvider.selector.configure' }))

    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(onConfigureEmptyState).toHaveBeenCalledTimes(1)
  })

  it('should close the popup before opening provider settings', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    renderWithQueryClient(<ModelSelector models={[makeModel()]} onHide={onHide} />)

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    await user.click(triggerButton)
    await user.click(
      screen.getByRole('button', {
        name: 'modelProvider.modelProvider.selector.modelProviderSettings',
      }),
    )

    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(onHide).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('provider'),
    )
  })

  it('should not open popup when disabled', async () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} disabled />)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should open and select a model from the split trigger with the keyboard', async () => {
    const onValueChange = vi.fn()
    renderWithQueryClient(
      <SplitModelSelector models={[makeModel()]} onValueChange={onValueChange} />,
    )

    const trigger = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    trigger.focus()
    await userEvent.setup().keyboard('{Enter}')
    const model = screen.getByRole('button', { name: /GPT-4/ })
    model.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(onValueChange).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      plugin_id: 'langgenius/openai',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['openai', 'uninstalled-provider'])(
    'should display a loaded default model as incompatible when missing from the list (%s)',
    (provider) => {
      const models = [makeModel()]
      function SystemDefaultSelector({ defaultModel }: { defaultModel?: DefaultModelResponse }) {
        const [value] = useSystemDefaultModelAndModelList(defaultModel, models)
        return <ModelSelector value={value} models={models} />
      }
      const { rerender } = renderWithQueryClient(<SystemDefaultSelector />)

      expect(
        screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
      ).toBeInTheDocument()

      rerender(
        <SystemDefaultSelector
          defaultModel={{
            model: 'missing-model',
            model_type: ModelTypeEnum.textGeneration,
            provider: {
              provider,
              icon_small: { en_US: '', zh_Hans: '' },
              label: { en_US: provider, zh_Hans: provider },
              supported_model_types: [],
              tenant_id: 'tenant-1',
            },
          }}
        />,
      )

      expect(
        screen.getByRole('button', {
          name: 'missing-model modelProvider.modelProvider.selector.incompatible',
        }),
      ).toBeEnabled()
      expect(screen.queryByText('plugin.detailPanel.configureModel')).not.toBeInTheDocument()
    },
  )
})
