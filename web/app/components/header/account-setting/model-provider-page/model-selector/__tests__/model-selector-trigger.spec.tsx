import type {
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement, ReactNode } from 'react'
import { Popover } from '@langgenius/dify-ui/popover'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createProviderSummaryFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../../declarations'
import { ModelSelectorTrigger } from '../model-selector-trigger'

let providerSummary: ReturnType<typeof createProviderSummaryFixture>
let catalogAvailable: boolean
let exhausted: boolean

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.summary.get': () => new Promise(() => {}),
    }),
  }
})

const renderComponent = (node: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (catalogAvailable) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
      {
        data: [providerSummary],
        plugins: {},
      },
    )
  }
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    pool_type: 'trial',
    model_billing_source: 'legacy_message_credits',
    model_billing_migration_status: 'none',
    quota_limit: 100,
    quota_used: exhausted ? 100 : 40,
    remaining_credits: exhausted ? 0 : 60,
    is_unlimited: false,
    is_exhausted: exhausted,
    exhausted_at: null,
    next_credit_reset_date: null,
  })
  return renderWithConsoleQuery(node, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
    trialModels: ['openai'],
  })
}
const render = (node: ReactNode) => renderComponent(<Popover>{node}</Popover>)
const getTrigger = () =>
  screen.getByRole('button', { name: /GPT-4|plugin.detailPanel.configureModel/ })

const createModelItem = (
  overrides: Partial<ProviderModelWithStatusEntity> = {},
): ProviderModelWithStatusEntity => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  features: [ModelFeatureEnum.vision],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode: 'chat', context_size: 4096 },
  load_balancing_enabled: false,
  ...overrides,
})

const createModel = (
  overrides: Partial<ProviderWithModelsResponse> = {},
): ProviderWithModelsResponse => ({
  tenant_id: 'test-workspace',
  provider: 'openai',
  icon_small: {
    en_US: 'https://example.com/openai-light.png',
    zh_Hans: 'https://example.com/openai-light.png',
  },
  icon_small_dark: {
    en_US: 'https://example.com/openai-dark.png',
    zh_Hans: 'https://example.com/openai-dark.png',
  },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

describe('ModelSelectorTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    catalogAvailable = true
    exhausted = false
    providerSummary = createProviderSummaryFixture({
      preferred_provider_type: 'system',
      custom_configuration: {
        status: 'no-configure',
        available_credentials: [],
        current_credential_usable: false,
      },
      system_configuration: {
        enabled: true,
      },
    })
  })

  it('keeps an existing model neutral while its catalog is unresolved', () => {
    const { rerender } = render(
      <ModelSelectorTrigger loading defaultModel={{ provider: 'openai', model: 'legacy-model' }} />,
    )
    expect(screen.getByRole('button', { name: 'legacy-model' })).toBeDisabled()
    expect(
      screen.queryByText('modelProvider.modelProvider.selector.incompatible'),
    ).not.toBeInTheDocument()
    rerender(
      <Popover>
        <ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />
      </Popover>,
    )
    expect(
      screen.getByRole('button', {
        name: 'legacy-model modelProvider.modelProvider.selector.incompatible',
      }),
    ).toBeEnabled()
  })

  it('does not report incompatibility before provider metadata is available', () => {
    catalogAvailable = false
    render(
      <ModelSelectorTrigger currentProvider={createModel()} currentModel={createModelItem()} />,
    )
    expect(screen.getByRole('button', { name: 'GPT-4' })).toBeEnabled()
    expect(
      screen.queryByText('modelProvider.modelProvider.selector.incompatible'),
    ).not.toBeInTheDocument()
  })

  describe('Rendering', () => {
    it('should render empty state when no model is selected', () => {
      render(<ModelSelectorTrigger />)

      expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
      expect(getTrigger()).toBeEnabled()
    })

    it('should render selected model details when model is active', () => {
      const currentProvider = createModel()
      const currentModel = createModelItem()
      render(<ModelSelectorTrigger currentProvider={currentProvider} currentModel={currentModel} />)

      expect(screen.getByText('GPT-4')).toBeInTheDocument()
      expect(screen.getByText('CHAT')).toBeInTheDocument()
      expect(getTrigger()).toHaveAccessibleName('GPT-4 CHAT')
      expect(getTrigger()).toBeEnabled()
    })
  })

  describe('Props', () => {
    it('should disable the combobox trigger', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem()}
          disabled
        />,
      )

      expect(getTrigger()).toBeDisabled()
    })
  })

  describe('Clearing the selection', () => {
    it('clears without opening the model picker or submitting the containing form', async () => {
      const user = userEvent.setup()
      const onClear = vi.fn()
      const onOpenChange = vi.fn()
      const onSubmit = vi.fn((event) => event.preventDefault())
      renderComponent(
        <form onSubmit={onSubmit}>
          <Popover onOpenChange={onOpenChange}>
            <ModelSelectorTrigger
              currentProvider={createModel()}
              currentModel={createModelItem()}
              defaultModel={{ provider: 'openai', model: 'gpt-4' }}
              onClear={onClear}
              clearLabel="Reset model"
            />
          </Popover>
        </form>,
      )

      await user.click(screen.getByRole('button', { name: 'Reset model' }))

      expect(onClear).toHaveBeenCalledTimes(1)
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
      await user.click(getTrigger())
      expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything())
    })

    it.each([{ disabled: true }, { loading: true }])(
      'prevents clearing when unavailable: %o',
      async (props) => {
        const user = userEvent.setup()
        const onClear = vi.fn()
        render(
          <ModelSelectorTrigger
            currentProvider={createModel()}
            currentModel={createModelItem()}
            defaultModel={{ provider: 'openai', model: 'gpt-4' }}
            onClear={onClear}
            clearLabel="Reset model"
            {...props}
          />,
        )

        const clearButton = screen.getByRole('button', { name: 'Reset model' })
        expect(clearButton).toBeDisabled()
        await user.click(clearButton)
        expect(onClear).not.toHaveBeenCalled()
      },
    )

    it('does not offer clear for an empty selection', () => {
      render(<ModelSelectorTrigger onClear={vi.fn()} clearLabel="Reset model" />)

      expect(screen.queryByRole('button', { name: 'Reset model' })).not.toBeInTheDocument()
    })
  })

  describe('Status Handling', () => {
    it('should show status badge when selected model is not active and enabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noConfigure })}
        />,
      )

      expect(
        screen.getByText('modelProvider.modelProvider.selector.configureRequired'),
      ).toBeInTheDocument()
    })

    it('should show credits exhausted state when model quota is exceeded', () => {
      exhausted = true

      render(
        <ModelSelectorTrigger currentProvider={createModel()} currentModel={createModelItem()} />,
      )

      expect(
        screen.getByText('modelProvider.modelProvider.selector.creditsExhausted'),
      ).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })

    it('should hide model meta when api key is unavailable', () => {
      exhausted = true
      providerSummary.preferred_provider_type = 'custom'
      providerSummary.custom_configuration = {
        ...providerSummary.custom_configuration,
        current_credential_usable: false,
        status: 'active',
        current_credential_id: 'key-1',
        current_credential_name: 'Primary Key',
        available_credentials: [{ credential_id: 'key-1', credential_name: 'Primary Key' }],
      }

      render(
        <ModelSelectorTrigger currentProvider={createModel()} currentModel={createModelItem()} />,
      )

      expect(
        screen.getByText('modelProvider.modelProvider.selector.apiKeyUnavailable'),
      ).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })

    it('should show disabled badge when selected model is disabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.disabled })}
        />,
      )

      expect(screen.getByText('modelProvider.modelProvider.selector.disabled')).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })

    it('should not show status badge when selected model is disabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noConfigure })}
          disabled
        />,
      )

      expect(
        screen.queryByText('modelProvider.modelProvider.selector.configureRequired'),
      ).not.toBeInTheDocument()
    })

    it('should show incompatible tooltip when hovering no-permission status badge', async () => {
      const user = userEvent.setup()
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noPermission })}
        />,
      )

      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
      await user.hover(screen.getByText('modelProvider.modelProvider.selector.incompatible'))

      expect(
        await screen.findByText('modelProvider.modelProvider.selector.incompatibleTip'),
      ).toBeInTheDocument()
    })

    it('should show incompatible badge when selected model fails the compatibility predicate', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem()}
          isModelCompatible={false}
        />,
      )

      expect(
        screen.getByText('modelProvider.modelProvider.selector.incompatible'),
      ).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should show incompatible badge for deprecated selection', async () => {
      const user = userEvent.setup()
      render(<ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />)

      expect(
        screen.getByText('modelProvider.modelProvider.selector.incompatible'),
      ).toBeInTheDocument()
      await user.hover(screen.getByText('modelProvider.modelProvider.selector.incompatible'))

      expect(
        await screen.findByText('modelProvider.modelProvider.selector.incompatibleTip'),
      ).toBeInTheDocument()
    })

    it('should show credits exhausted badge for deprecated selection when ai credits are exhausted without api key', async () => {
      const user = userEvent.setup()
      exhausted = true
      providerSummary.preferred_provider_type = 'custom'

      render(<ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />)

      expect(
        screen.getByText('modelProvider.modelProvider.selector.creditsExhausted'),
      ).toBeInTheDocument()
      await user.hover(screen.getByText('modelProvider.modelProvider.selector.creditsExhausted'))

      expect(
        await screen.findByText('modelProvider.modelProvider.selector.creditsExhaustedTip'),
      ).toBeInTheDocument()
    })
  })
})
