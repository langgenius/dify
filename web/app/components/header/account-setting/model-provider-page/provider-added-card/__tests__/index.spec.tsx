import type { ComponentProps } from 'react'
import type { ModelProviderPluginSummary } from '../../index'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { zModelWithProviderEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createProviderResponseFixture,
  createProviderSummaryFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useExpandModelProviderList } from '../../atoms'
import { ConfigurationMethodEnum } from '../../declarations'
import ProviderAddedCard from '../index'

const api = vi.hoisted(() => ({
  providers: vi.fn<typeof consoleClient.workspaces.current.modelProviders.get>(),
  models: vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.models.get>(),
  disable:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.models.disable.patch>(),
  uninstall: vi.fn<typeof consoleClient.workspaces.current.plugin.uninstall.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'workspaces.current.modelProviders.byProvider.models.get': api.models,
      'workspaces.current.modelProviders.get': api.providers,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.disable.patch': api.disable,
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': async () => ({
        category: 'model',
        auto_upgrade: {
          strategy_setting: 'disabled',
          upgrade_mode: 'all',
          upgrade_time_of_day: 0,
          include_plugins: [],
          exclude_plugins: [],
        },
      }),
    }),
  }
})
const providerId = 'langgenius/openai/openai'
const provider = createProviderSummaryFixture({
  provider: providerId,
  icon_small: { en_US: 'openai.svg' },
})
const model = zModelWithProviderEntityResponse.parse({
  ...createCatalogModelFixture(),
  provider: {
    provider: providerId,
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    tenant_id: 'tenant-1',
  },
})
const pluginSummary: ModelProviderPluginSummary = {
  installation_id: 'installation-1',
  plugin_id: 'langgenius/openai',
  plugin_unique_identifier: 'langgenius/openai:1.0.0@test',
  runtime_type: 'local',
  source: 'marketplace',
  version: '1.0.0',
}
function ExternalExpandControls() {
  const expand = useExpandModelProviderList()
  return (
    <>
      <button type="button" onClick={() => expand('langgenius/anthropic/anthropic')}>
        Expand Anthropic
      </button>
      <button type="button" onClick={() => expand(providerId)}>
        Expand OpenAI
      </button>
    </>
  )
}
function setup(
  props: Partial<ComponentProps<typeof ProviderAddedCard>> = {},
  options: ConsoleQueryTestOptions = {},
) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <ProviderAddedCard provider={provider} {...props} />
      <ExternalExpandControls />
    </NuqsTestingAdapter>,
    {
      queryClient,
      features: {},
      systemFeatures: { rbac_enabled: false, deployment_edition: 'COMMUNITY' },
      workspacePermissionKeys: [
        'plugin.plugin_preferences',
        'plugin.model_config',
        'credential.use',
        'credential.create',
        'credential.manage',
        'plugin.delete',
      ],
      ...options,
    },
  )
  return { user: userEvent.setup(), queryClient }
}
const showModels = () =>
  screen.getByRole('button', { name: /modelProvider.modelProvider.showModels/ })
const modelCount = () =>
  screen.getByRole('button', { name: /modelProvider.modelProvider.modelsNum/ })
const addCredential = () =>
  screen.queryByRole('button', {
    name: /modelProvider.modelProvider.auth.addApiKey|common.operation.config/,
  })
beforeEach(() => {
  api.providers
    .mockReset()
    .mockResolvedValue({ data: [createProviderResponseFixture({ provider: providerId })] })
  api.models.mockReset().mockResolvedValue({ data: [model] })
  api.disable.mockReset().mockResolvedValue({ result: 'success' })
  api.uninstall.mockReset().mockResolvedValue({ success: true })
})

it.each([false, true])(
  'applies credential permissions with RBAC enabled=%s while preventing unprivileged model expansion',
  async (rbacEnabled) => {
    const { user } = setup(
      {},
      {
        systemFeatures: { rbac_enabled: rbacEnabled },
        workspacePermissionKeys: ['credential.use'],
      },
    )
    if (rbacEnabled) expect(addCredential()).toBeInTheDocument()
    else expect(addCredential()).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /modelProvider.modelProvider.showModels/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand OpenAI' }))
    expect(api.models).not.toHaveBeenCalled()
  },
)

it('opens the real model list, refreshes it after a model change, and restores focus after collapsing', async () => {
  const { user } = setup()
  await user.click(showModels())
  expect(await screen.findByText('GPT-4')).toBeInTheDocument()
  expect(api.models).toHaveBeenCalledWith({ params: { provider: providerId } })
  const modelSwitch = screen.getByRole('switch', { name: 'GPT-4' })
  expect(modelSwitch).toBeChecked()
  api.disable.mockImplementationOnce(async () => {
    api.models.mockResolvedValue({ data: [{ ...model, status: 'disabled' }] })
    return { result: 'success' }
  })
  await user.click(modelSwitch)
  await waitFor(() =>
    expect(api.disable).toHaveBeenCalledExactlyOnceWith({
      params: { provider: providerId },
      body: { model: 'gpt-4', model_type: 'llm' },
    }),
  )
  await waitFor(() => expect(modelSwitch).not.toBeChecked())
  await user.click(modelCount())
  await waitFor(() => expect(screen.queryByText('GPT-4')).not.toBeInTheDocument())
  expect(modelCount()).toHaveFocus()
  await user.click(modelCount())
  expect(await screen.findByRole('switch', { name: 'GPT-4' })).not.toBeChecked()
})

it('does not send duplicate model requests while expansion is loading', async () => {
  const response = createDeferred<Awaited<ReturnType<typeof api.models>>>()
  api.models.mockReturnValueOnce(response.promise)
  const { user } = setup()
  await user.click(showModels())
  await user.click(showModels())
  expect(api.models).toHaveBeenCalledTimes(1)
  await act(async () => response.resolve({ data: [model] }))
  expect(await screen.findByText('GPT-4')).toBeInTheDocument()
})

it('expands only when requested for this provider', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Expand Anthropic' }))
  expect(api.models).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Expand OpenAI' }))
  expect(await screen.findByText('GPT-4')).toBeInTheDocument()
  expect(api.models).toHaveBeenCalledExactlyOnceWith({ params: { provider: providerId } })
})

it('directs an unconfigured provider to credentials instead of offering models', () => {
  setup({
    provider: createProviderSummaryFixture({ provider: 'custom/provider', is_configured: false }),
    notConfigured: true,
  })
  expect(screen.getByText('modelProvider.modelProvider.configureTip')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /modelProvider.modelProvider.showModels/ }),
  ).not.toBeInTheDocument()
})

it.each([
  {
    label: 'model configuration with custom models',
    permissions: ['plugin.model_config'],
    hasCustomModels: true,
    canAdd: true,
    canManage: true,
  },
  {
    label: 'model configuration without custom models',
    permissions: ['plugin.model_config'],
    hasCustomModels: false,
    canAdd: true,
    canManage: false,
  },
  {
    label: 'credential permissions only',
    permissions: ['credential.use', 'credential.create', 'credential.manage'],
    hasCustomModels: true,
    canAdd: false,
    canManage: false,
  },
])(
  'offers custom model actions for $label',
  ({ permissions, hasCustomModels, canAdd, canManage }) => {
    setup(
      {
        provider: createProviderSummaryFixture({
          provider: providerId,
          configurate_methods: [ConfigurationMethodEnum.customizableModel],
          custom_configuration: { has_custom_models: hasCustomModels },
        }),
      },
      { workspacePermissionKeys: permissions },
    )
    const add = screen.queryByRole('button', { name: 'modelProvider.modelProvider.addModel' })
    const manage = screen.queryByRole('button', {
      name: 'modelProvider.modelProvider.auth.manageCredentials',
    })
    if (canAdd) expect(add).toBeInTheDocument()
    else expect(add).not.toBeInTheDocument()
    if (canManage) expect(manage).toBeInTheDocument()
    else expect(manage).not.toBeInTheDocument()
  },
)

it('invalidates provider catalogs and installed model plugins after removal through the real menu', async () => {
  const { user, queryClient } = setup({ pluginSummary })
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.get.queryKey(), {
    data: [createProviderResponseFixture({ provider: providerId })],
  })
  const installedKey = consoleQuery.workspaces.current.plugin.byCategory.list.get.infiniteOptions({
    input: (page) => ({ params: { category: 'model' }, query: { page, page_size: 100 } }),
    getNextPageParam: () => undefined,
    initialPageParam: 1,
  }).queryKey
  queryClient.setQueryData(installedKey, {
    pages: [{ plugins: [], has_more: false, builtin_tools: [] }],
    pageParams: [1],
  })
  const keys = [
    installedKey,
    consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
    consoleQuery.workspaces.current.modelProviders.get.queryKey(),
  ]
  await user.click(
    await screen.findByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
  )
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
  )
  const dialog = await screen.findByRole('alertdialog', { name: 'plugin.action.delete' })
  expect(api.uninstall).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.uninstall).toHaveBeenCalledExactlyOnceWith({
      body: { plugin_installation_id: 'installation-1', preserve_credentials: false },
    }),
  )
  await waitFor(() => {
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('loads custom model credentials only when their management surface opens', async () => {
  const response = createDeferred<Awaited<ReturnType<typeof api.providers>>>()
  api.providers.mockReturnValueOnce(response.promise)
  const { user } = setup({
    provider: createProviderSummaryFixture({
      provider: providerId,
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
      custom_configuration: { has_custom_models: true },
    }),
  })
  expect(api.providers).not.toHaveBeenCalled()
  const manage = screen.getByRole('button', {
    name: 'modelProvider.modelProvider.auth.manageCredentials',
  })
  await user.click(manage)
  expect(manage).toHaveAttribute('aria-disabled', 'true')
  expect(api.providers).toHaveBeenCalledTimes(1)
  await act(async () =>
    response.resolve({
      data: [
        createProviderResponseFixture({
          provider: providerId,
          configurate_methods: ['customizable-model'],
          custom_configuration: {
            custom_models: [
              {
                model: 'custom-gpt',
                model_type: 'llm',
                credentials: null,
                unadded_to_model_list: false,
                current_credential_id: 'credential-1',
                current_credential_name: 'Production key',
                available_model_credentials: [
                  { credential_id: 'credential-1', credential_name: 'Production key' },
                ],
              },
            ],
          },
        }),
      ],
    }),
  )
  expect(
    await screen.findByText('modelProvider.modelProvider.auth.customModelCredentials'),
  ).toBeInTheDocument()
  expect(screen.getByText('custom-gpt')).toBeInTheDocument()
  expect(screen.getByText('Production key')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('Production key')).not.toBeInTheDocument())
})
