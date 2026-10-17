import type { ModelItem } from '../../declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient } from '@/service/console'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { modelProviderDetailsQueryOptions } from '../../utils'
import ModelListItem from '../model-list-item'

const { permissions, updateModelList } = vi.hoisted(() => ({
  permissions: { value: ['plugin.model_config'] as string[] },
  updateModelList: vi.fn(),
}))
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: permissions.value }))
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const { zGetFeaturesResponse } = await import('@dify/contracts/api/console/features/zod.gen')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': () => zGetFeaturesResponse.parse({}),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.enable.patch': vi.fn(),
      'workspaces.current.modelProviders.byProvider.models.disable.patch': vi.fn(),
    }),
  }
})
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useUpdateModelList: () => updateModelList,
}))

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

beforeEach(() => {
  vi.clearAllMocks()
  permissions.value = ['plugin.model_config']
})
afterEach(() => vi.useRealTimers())

it.each([
  { status: ModelStatusEnum.active, action: 'disable' as const },
  { status: ModelStatusEnum.disabled, action: 'enable' as const },
])(
  '$action submits the selected model and refreshes the owning model list',
  async ({ status, action }) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithConsoleQuery(
      <ModelListItem
        model={{ ...model, status }}
        provider={provider}
        isConfigurable={false}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('switch', { name: 'GPT-4' }))
    expect(mutations[action].patch).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(mutations[action].patch).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'test-provider' },
        body: { model: 'gpt-4', model_type: 'llm' },
      }),
    )
    expect(updateModelList).toHaveBeenCalledWith(ModelTypeEnum.textGeneration)
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
  permissions.value = []
  renderWithConsoleQuery(<ModelListItem model={model} provider={provider} isConfigurable />, {
    features: { model_load_balancing_enabled: true },
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
