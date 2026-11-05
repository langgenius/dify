import type { ModelItem } from '../../declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient, consoleQuery } from '@/service/console'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery as renderWithQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { modelProviderDetailsQueryOptions } from '../../utils'
import ModelListItem from '../model-list-item'

const { listModelUsages } = vi.hoisted(() => ({ listModelUsages: vi.fn() }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.usages.get': listModelUsages,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.enable.patch': vi
        .fn()
        .mockResolvedValue({ result: 'success' }),
      'workspaces.current.modelProviders.byProvider.models.disable.patch': vi
        .fn()
        .mockResolvedValue({ result: 'success' }),
    }),
  }
})

const renderWithConsoleQuery: typeof renderWithQuery = (ui, options) =>
  renderWithQuery(ui, {
    workspacePermissionKeys: ['plugin.model_config'],
    features: {},
    ...options,
  })

const provider = modelProviderDetailsQueryOptions().select!({
  data: [createProviderResponseFixture({ provider: 'test-provider' })],
}).data[0]!
const model: ModelItem = {
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  deprecated: false,
  load_balancing_enabled: false,
  has_invalid_load_balancing_configs: false,
}
const mutations = consoleClient.workspaces.current.modelProviders.byProvider.models
const configName = 'common.operation.config'

it.each([
  { status: ModelStatusEnum.active, action: 'disable' as const },
  { status: ModelStatusEnum.disabled, action: 'enable' as const },
])(
  '$action submits the selected model and refreshes the owning model list',
  async ({ status, action }) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { queryClient } = renderWithConsoleQuery(
      <ModelListItem
        model={{ ...model, status }}
        provider={provider}
        isConfigurable={false}
        onChange={onChange}
      />,
    )

    const catalogKey = consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    })
    const providerKey =
      consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
        input: { params: { provider: provider.provider } },
      })
    queryClient.setQueryData(catalogKey, { data: [] })
    queryClient.setQueryData(providerKey, { data: [] })
    await user.click(screen.getByRole('switch', { name: 'GPT-4' }))
    expect(mutations[action].patch).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(mutations[action].patch).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'test-provider' },
        body: { model: 'gpt-4', model_type: 'llm' },
      }),
    )
    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(providerKey)?.isInvalidated).toBe(true)
    expect(onChange).toHaveBeenCalledWith('test-provider')
  },
)

it.each([
  {
    edition: 'COMMUNITY' as const,
    plan: 'professional' as const,
    balancing: false,
    configurable: true,
  },
  { edition: 'CLOUD' as const, plan: 'sandbox' as const, balancing: false, configurable: true },
  {
    edition: 'CLOUD' as const,
    plan: 'professional' as const,
    balancing: false,
    configurable: false,
  },
  { edition: 'CLOUD' as const, plan: 'professional' as const, balancing: true, configurable: true },
])(
  'gates configuration for $edition/$plan with load balancing $balancing',
  async ({ edition, plan, balancing, configurable }) => {
    const user = userEvent.setup()
    const onModifyLoadBalancing = vi.fn()
    renderWithConsoleQuery(
      <ModelListItem
        model={model}
        provider={provider}
        isConfigurable
        onModifyLoadBalancing={onModifyLoadBalancing}
      />,
      {
        systemFeatures: { deployment_edition: edition },
        features: { billing: { subscription: { plan } }, model_load_balancing_enabled: balancing },
      },
    )
    if (configurable) {
      await user.click(screen.getByRole('button', { name: configName }))
      expect(onModifyLoadBalancing).toHaveBeenCalledExactlyOnceWith(model)
    } else {
      expect(screen.queryByRole('button', { name: configName })).not.toBeInTheDocument()
    }
  },
)

it('hides model controls without model configuration permission', () => {
  renderWithConsoleQuery(<ModelListItem model={model} provider={provider} isConfigurable />, {
    features: { model_load_balancing_enabled: true },
    workspacePermissionKeys: [],
  })
  expect(screen.getByText('GPT-4')).toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: configName })).not.toBeInTheDocument()
})

it.each([
  { deprecated: true, status: ModelStatusEnum.active },
  { deprecated: false, status: ModelStatusEnum.credentialRemoved },
])(
  'prevents configuration and toggling for unavailable models ($deprecated/$status)',
  async (state) => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <ModelListItem model={{ ...model, ...state }} provider={provider} isConfigurable />,
      {
        features: { model_load_balancing_enabled: true },
      },
    )
    const toggle = screen.getByRole('switch', { name: 'GPT-4' })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(mutations.enable.patch).not.toHaveBeenCalled()
    expect(mutations.disable.patch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: configName })).not.toBeInTheDocument()
  },
)

it('lists where an LLM is used for members who manage model preferences', async () => {
  const user = userEvent.setup()
  listModelUsages.mockResolvedValue({
    data: [
      {
        app_id: 'app-1',
        app_name: 'Support flow',
        app_mode: 'advanced-chat',
        source: 'workflow_published',
        node_id: 'llm-1',
        node_title: 'Answer',
        node_type: 'llm',
      },
      {
        app_id: 'app-2',
        app_name: 'Support bot',
        app_mode: 'chat',
        source: 'app_model_config',
        node_id: null,
        node_title: null,
        node_type: null,
      },
    ],
    inaccessible_count: 0,
  })
  renderWithConsoleQuery(<ModelListItem model={model} provider={provider} isConfigurable />, {
    workspacePermissionKeys: ['plugin.plugin_preferences'],
  })

  await user.click(screen.getByRole('button', { name: 'modelProvider.modelProvider.usage.view' }))

  expect(await screen.findByRole('link', { name: 'Support flow' })).toHaveAttribute(
    'href',
    '/app/app-1/workflow',
  )
  expect(
    screen.getByText('modelProvider.modelProvider.usage.source.workflow_published · Answer'),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Support bot' })).toHaveAttribute(
    'href',
    '/app/app-2/configuration',
  )
  expect(listModelUsages).toHaveBeenCalledExactlyOnceWith({
    params: { provider: 'test-provider' },
    query: { model: 'gpt-4', model_type: 'llm' },
  })
  expect(screen.queryByText(/modelProvider\.usage\.inaccessible/)).not.toBeInTheDocument()
})

it('says how many usages are withheld instead of reporting none', async () => {
  const user = userEvent.setup()
  listModelUsages.mockResolvedValue({ data: [], inaccessible_count: 3 })
  renderWithConsoleQuery(<ModelListItem model={model} provider={provider} isConfigurable />, {
    workspacePermissionKeys: ['plugin.plugin_preferences'],
  })

  await user.click(screen.getByRole('button', { name: 'modelProvider.modelProvider.usage.view' }))

  expect(
    await screen.findByText('modelProvider.modelProvider.usage.inaccessible:{"count":3}'),
  ).toBeInTheDocument()
  expect(screen.queryByText('modelProvider.modelProvider.usage.empty')).not.toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})

it.each([
  { permissions: ['plugin.model_config'], modelType: ModelTypeEnum.textGeneration },
  { permissions: ['plugin.plugin_preferences'], modelType: ModelTypeEnum.textEmbedding },
])('hides the usage entry for $permissions on $modelType models', ({ permissions, modelType }) => {
  renderWithConsoleQuery(
    <ModelListItem
      model={{ ...model, model_type: modelType }}
      provider={provider}
      isConfigurable
    />,
    { workspacePermissionKeys: permissions },
  )
  expect(screen.getByText('GPT-4')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'modelProvider.modelProvider.usage.view' }),
  ).not.toBeInTheDocument()
})
