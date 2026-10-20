import type { ProviderModelWithStatusEntity } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PopupProps } from '../popup'
import type { consoleClient } from '@/service/console'
import type { fetchPluginInfoFromMarketPlace } from '@/service/plugins'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  createModelCreditsFixture,
  createProviderResponseFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { ModelFeatureEnum } from '../../declarations'
import Popup from '../popup'

const api = vi.hoisted(() => ({
  summary: vi.fn<typeof consoleClient.workspaces.current.modelProviders.summary.get>(),
  catalog: vi.fn<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>(),
  install: vi.fn<typeof consoleClient.workspaces.current.plugin.install.marketplace.post>(),
  task: vi.fn<typeof consoleClient.workspaces.current.plugin.tasks.byTaskId.get>(),
  lookup: vi.fn<typeof fetchPluginInfoFromMarketPlace>(),
  providers: vi.fn<typeof consoleClient.workspaces.current.modelProviders.get>(),
  credential:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.get>(),
  addCredential:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.post>(),
  editCredential:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.put>(),
  locale: 'en-US',
}))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => api.locale,
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  fetchPluginInfoFromMarketPlace: api.lookup,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.summary.get': api.summary,
      'workspaces.current.modelProviders.get': api.providers,
      'workspaces.current.modelProviders.byProvider.credentials.get': api.credential,
      'workspaces.current.models.modelTypes.byModelType.get': api.catalog,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': api.install,
      'workspaces.current.plugin.tasks.byTaskId.get': api.task,
      'workspaces.current.modelProviders.byProvider.credentials.post': api.addCredential,
      'workspaces.current.modelProviders.byProvider.credentials.put': api.editCredential,
    }),
  }
})

type Summary = Awaited<ReturnType<typeof api.summary>>
type Credits = ReturnType<typeof createModelCreditsFixture>
type HarnessProps = Omit<PopupProps, 'inputValue' | 'onInputValueChange'>
const OPENAI = ModelProviderQuotaGetPaid.OPENAI
const ANTHROPIC = ModelProviderQuotaGetPaid.ANTHROPIC
const packageId = 'langgenius/openai:1.0.0@hash'
const installButton = () => screen.getByRole('button', { name: /selector.install OpenAI$/ })
const searchInput = () => screen.getByRole('searchbox', { name: 'modelProvider.form.searchModel' })
const model = (name: string, overrides: Partial<ProviderModelWithStatusEntity> = {}) =>
  createCatalogModelFixture({
    model: name,
    label: { en_US: name },
    ...overrides,
  })
const provider = (key: string, label: string, models: ProviderModelWithStatusEntity[]) =>
  createModelCatalogFixture({
    provider: key,
    label: { en_US: label },
    models,
  })
const catalog = [
  provider(OPENAI, 'OpenAI', [
    model('gpt-4'),
    model('gpt-5.4-mini', { label: { en_US: 'GPT 5.4 Mini' } }),
  ]),
  provider(ANTHROPIC, 'Anthropic', [
    model('claude-3', { label: { en_US: 'Claude Sonnet' } }),
    model('claude-instant'),
  ]),
  provider(ModelProviderQuotaGetPaid.GEMINI, 'Gemini', [model('gemini-pro')]),
  provider(ModelProviderQuotaGetPaid.TONGYI, 'Tongyi', [model('qwen-plus')]),
  provider('langgenius/openrouter/openrouter', 'OpenRouter', [model('router-model')]),
  provider('azure_openai', 'Azure', [model('azure-model')]),
]
const catalogLabels = [
  'gpt-4',
  'GPT 5.4 Mini',
  'Claude Sonnet',
  'claude-instant',
  'gemini-pro',
  'qwen-plus',
  'router-model',
  'azure-model',
]
const summaryFor = (models: PopupProps['modelList']): Summary => ({
  data: models.map((entry) =>
    createProviderSummaryFixture({
      provider: entry.provider,
      label: entry.label,
      custom_configuration: {
        available_credentials: [{ credential_id: 'key-1', credential_name: 'Workspace key' }],
        current_credential_id: 'key-1',
        current_credential_name: 'Workspace key',
      },
    }),
  ),
  plugins: {},
})
const installedSummary = (): Summary => ({
  data: [
    createProviderSummaryFixture({
      provider: OPENAI,
      label: { en_US: 'OpenAI' },
      system_configuration: { enabled: true },
    }),
  ],
  plugins: {
    [OPENAI]: {
      plugin_id: 'langgenius/openai',
      installation_id: 'installed-openai',
      plugin_unique_identifier: packageId,
      runtime_type: 'local',
      source: 'marketplace',
      version: '1.0.0',
    },
  },
})
const taskResponse = (status: 'success' | 'failed'): Awaited<ReturnType<typeof api.task>> => ({
  task: {
    id: 'install-task',
    status,
    total_plugins: 1,
    completed_plugins: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    plugins: [
      {
        plugin_id: 'langgenius/openai',
        plugin_unique_identifier: packageId,
        status,
        icon: '',
        labels: { en_US: 'OpenAI' },
        message: status === 'failed' ? 'Installation failed' : '',
      },
    ],
  },
})

function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(true)
  const [inputValue, setInputValue] = useState('')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>Selected model</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Model selector</PopoverTitle>
        <Popup
          {...props}
          inputValue={inputValue}
          onInputValueChange={setInputValue}
          onHide={() => {
            setOpen(false)
            props.onHide()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

async function setup(
  props: Partial<HarnessProps> = {},
  options: {
    summary?: Summary
    credits?: Partial<Credits>
    marketplace?: boolean
    installPermission?: boolean
    trialModels?: string[]
    permissions?: string[]
  } = {},
) {
  const modelList = props.modelList ?? catalog
  const summary = options.summary ?? summaryFor(modelList)
  api.summary.mockResolvedValue(summary)
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
    summary,
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    ...createModelCreditsFixture(),
    ...options.credits,
  })
  const onSelect = vi.fn<HarnessProps['onSelect']>()
  const onHide = vi.fn()
  await act(async () =>
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <ModalContextProvider>
          <Harness modelList={modelList} onSelect={onSelect} onHide={onHide} {...props} />
        </ModalContextProvider>
      </NuqsTestingAdapter>,
      {
        queryClient,
        features: {},
        workspacePermissionKeys:
          options.permissions ?? (options.installPermission === false ? [] : ['plugin.install']),
        systemFeatures: {
          deployment_edition: 'CLOUD',
          rbac_enabled: true,
          enable_marketplace: options.marketplace ?? false,
        },
        trialModels: options.trialModels ?? [OPENAI, ANTHROPIC],
      },
    ),
  )
  return { user: userEvent.setup(), onSelect, onHide, queryClient }
}

beforeEach(() => {
  api.locale = 'en-US'
  api.providers.mockReset().mockResolvedValue({
    data: [
      createProviderResponseFixture({
        provider: OPENAI,
        custom_configuration: {
          available_credentials: [{ credential_id: 'key-1', credential_name: 'Workspace key' }],
          current_credential_id: 'key-1',
          current_credential_name: 'Workspace key',
        },
        provider_credential_schema: {
          credential_form_schemas: [
            {
              variable: 'api_key',
              type: 'secret-input',
              label: { en_US: 'API key' },
              required: true,
              max_length: 256,
              show_on: [],
            },
          ],
        },
      }),
    ],
  })
  api.credential.mockReset().mockResolvedValue({ credentials: { api_key: 'masked-key' } })
  api.addCredential.mockReset().mockResolvedValue({ result: 'success' })
  api.editCredential.mockReset().mockResolvedValue({ result: 'success' })
  api.summary.mockReset().mockResolvedValue({ data: [], plugins: {} })
  api.catalog.mockReset().mockResolvedValue({ data: [] })
  api.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.task.mockReset().mockResolvedValue(taskResponse('success'))
  api.lookup.mockReset().mockResolvedValue({
    data: {
      plugin: {
        category: 'model',
        latest_package_identifier: packageId,
        latest_version: '1.0.0',
      },
      version: { version: '1.0.0' },
    },
  })
})

describe('searching real model options', () => {
  it.each([
    ['opnai', ['gpt-4', 'GPT 5.4 Mini', 'azure-model']],
    ['openai', ['gpt-4', 'GPT 5.4 Mini', 'azure-model']],
    ['sonnet', ['Claude Sonnet']],
    ['gpt54', ['GPT 5.4 Mini']],
    ['gemni', ['gemini-pro']],
    ['azure_openai', ['azure-model']],
    ['unknown-provider', []],
  ])('filters by %s without exposing unrelated providers or models', async (query, expected) => {
    const { user } = await setup()
    await user.type(searchInput(), query)
    for (const label of catalogLabels) {
      const option = screen.queryByRole('button', { name: label })
      if (expected.includes(label)) expect(option).toBeInTheDocument()
      else expect(option).not.toBeInTheDocument()
    }
    if (!expected.length)
      expect(screen.getByRole('status')).toHaveTextContent(
        'modelProvider.modelProvider.selector.noModelFoundForSearch',
      )
  })

  it('restores options after clearing search and selects the actual provider/model pair', async () => {
    const { user, onSelect } = await setup()
    await user.type(searchInput(), 'missing')
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(searchInput()).toHaveValue('')
    expect(searchInput()).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'GPT 5.4 Mini' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(
      OPENAI,
      expect.objectContaining({ model: 'gpt-5.4-mini' }),
    )
  })

  it('searches and renders fallback labels when the locale is unavailable', async () => {
    api.locale = 'fr-FR'
    const { user } = await setup({
      modelList: [
        provider(OPENAI, 'OpenAI', [model('writer', { label: { en_US: 'Writer model' } })]),
      ],
    })
    await user.type(searchInput(), 'writer')
    expect(screen.getByRole('button', { name: 'Writer model' })).toBeInTheDocument()
  })

  it.each([
    [[ModelFeatureEnum.toolCall], ['tool-call', 'multi-tool']],
    [[ModelFeatureEnum.vision], ['vision']],
    [[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision], []],
  ])(
    'keeps scope requirements when a search matches the provider: %j',
    async (scopeFeatures, expected) => {
      const models = [
        model('tool-call', { features: [ModelFeatureEnum.toolCall] }),
        model('multi-tool', { features: [ModelFeatureEnum.multiToolCall] }),
        model('vision', { features: [ModelFeatureEnum.vision] }),
        model('plain'),
      ]
      const { user } = await setup({
        modelList: [provider(OPENAI, 'OpenAI', models)],
        scopeFeatures,
      })
      await user.type(searchInput(), 'openai')
      for (const item of models)
        expect(screen.queryByRole('button', { name: item.model }) !== null).toBe(
          expected.some((name) => name === item.model),
        )
      expect(
        screen.getByText('modelProvider.modelProvider.selector.onlyCompatibleModelsShown'),
      ).toBeInTheDocument()
    },
  )

  it('reveals incompatible models on demand while preserving their selection behavior', async () => {
    const { user, onSelect } = await setup({
      modelList: [provider(OPENAI, 'OpenAI', [model('supported'), model('legacy')])],
      modelPredicate: (_provider, item) => item.model !== 'legacy',
    })
    expect(screen.queryByRole('button', { name: 'legacy' })).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'modelProvider.modelProvider.selector.showIncompatibleModels',
      }),
    )
    expect(screen.getByRole('button', { name: 'legacy' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'modelProvider.modelProvider.selector.hideIncompatibleModels',
      }),
    )
    expect(screen.queryByRole('button', { name: 'legacy' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'supported' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(
      OPENAI,
      expect.objectContaining({ model: 'supported' }),
    )
  })

  it('marks the selected model and puts its provider first', async () => {
    await setup({ defaultModel: { provider: ANTHROPIC, model: 'claude-3' } })
    const sections = within(
      screen.getByRole('region', { name: 'modelProvider.modelProvider.models' }),
    ).getAllByRole('region')
    expect(sections[0]).toHaveAccessibleName('Anthropic')
    expect(screen.getByRole('button', { name: 'Claude Sonnet' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'gpt-4' })).not.toHaveAttribute('aria-current')
  })

  it('keeps unavailable model options unselectable', async () => {
    const { user, onSelect } = await setup({
      modelList: [provider(OPENAI, 'OpenAI', [model('disabled', { status: 'disabled' })])],
    })
    const option = screen.getByRole('button', { name: 'disabled' })
    expect(option).toBeDisabled()
    await user.click(option)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('connects empty-state configuration and settings actions to their owner', async () => {
    const configure = vi.fn()
    const settings = vi.fn()
    const { user } = await setup({
      modelList: [],
      onConfigureEmptyState: configure,
      onOpenProviderSettings: settings,
    })
    const dialog = screen.getByRole('dialog', { name: 'Model selector' })
    expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', {
        name: 'modelProvider.modelProvider.selector.configure',
      }),
    )
    expect(configure).toHaveBeenCalledOnce()
    await user.click(
      within(dialog).getByRole('button', {
        name: 'modelProvider.modelProvider.selector.modelProviderSettings',
      }),
    )
    expect(settings).toHaveBeenCalledOnce()
  })
})

describe('workspace credits and marketplace availability', () => {
  it('updates the exhausted-credit alert when a usable API key becomes available', async () => {
    const summary: Summary = {
      data: [
        createProviderSummaryFixture({
          provider: OPENAI,
          label: { en_US: 'OpenAI' },
          system_configuration: { enabled: true },
          custom_configuration: { current_credential_usable: false },
        }),
      ],
      plugins: {},
    }
    const { queryClient } = await setup(
      { modelList: [] },
      { marketplace: true, summary, credits: { is_exhausted: true, remaining_credits: 0 } },
    )
    expect(
      screen.getByText('modelProvider.modelProvider.card.creditsExhaustedMessage'),
    ).toBeInTheDocument()
    act(() =>
      queryClient.setQueryData(
        consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
        {
          ...summary,
          data: summary.data.map((entry) => ({
            ...entry,
            custom_configuration: {
              ...entry.custom_configuration,
              current_credential_usable: true,
            },
          })),
        },
      ),
    )
    expect(
      await screen.findByText('modelProvider.modelProvider.card.creditsExhaustedFallback'),
    ).toBeInTheDocument()
  })

  it('does not advertise credits for providers outside the trial list', async () => {
    const summary: Summary = {
      data: [
        createProviderSummaryFixture({ provider: OPENAI, system_configuration: { enabled: true } }),
      ],
      plugins: {},
    }
    await setup(
      { modelList: [] },
      {
        marketplace: true,
        summary,
        trialModels: [ANTHROPIC],
        credits: { is_exhausted: true, remaining_credits: 0 },
      },
    )
    expect(
      screen.queryByText('modelProvider.modelProvider.card.creditsExhaustedMessage'),
    ).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'offers installed providers without models only with available credits (exhausted=%s)',
    async (exhausted) => {
      await setup(
        { modelList: [] },
        {
          marketplace: true,
          summary: installedSummary(),
          credits: { is_exhausted: exhausted, remaining_credits: exhausted ? 0 : 100 },
        },
      )
      expect(screen.queryByRole('region', { name: 'OpenAI' }) !== null).toBe(!exhausted)
      expect(
        screen.queryByRole('button', { name: /selector.install OpenAI$/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /selector.install Anthropic$/ }),
      ).toBeInTheDocument()
    },
  )

  it('keeps marketplace installation hidden when disabled by the deployment', async () => {
    await setup()
    expect(screen.queryByRole('button', { name: /selector.install/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /discoverMoreInMarketplace/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'gpt-4' })).toBeInTheDocument()
  })

  it('keeps marketplace discovery available without installation permission', async () => {
    await setup({ modelList: [] }, { marketplace: true, installPermission: false })
    expect(screen.queryByRole('button', { name: /selector.install/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /discoverMoreInMarketplace/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/plugins\/model$/),
    )
  })
})

describe('installation through real polling and invalidation', () => {
  it('refreshes the provider catalog after installation and removes the installed marketplace entry', async () => {
    const { user } = await setup({ modelList: [] }, { marketplace: true })
    api.summary.mockResolvedValue(installedSummary())
    api.catalog.mockClear()
    await user.click(installButton())
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /selector.install OpenAI$/ }),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findByRole('region', { name: 'OpenAI' })).toBeInTheDocument()
    expect(api.lookup).toHaveBeenCalledExactlyOnceWith({ org: 'langgenius', name: 'openai' })
    expect(api.install).toHaveBeenCalledWith({ body: { plugin_unique_identifiers: [packageId] } })
    expect(api.catalog).toHaveBeenCalledWith({ params: { model_type: 'llm' } })
  })

  it('allows retry after the install request fails without refreshing providers prematurely', async () => {
    const { user } = await setup({ modelList: [] }, { marketplace: true })
    api.install.mockRejectedValueOnce(new Error('Unavailable'))
    await user.click(installButton())
    await waitFor(() => expect(installButton()).toBeEnabled())
    expect(api.summary).not.toHaveBeenCalled()
    api.summary.mockResolvedValue(installedSummary())
    await user.click(installButton())
    await screen.findByRole('region', { name: 'OpenAI' })
    expect(api.install).toHaveBeenCalledTimes(2)
  })

  it('blocks another install while polling and refreshes only after a successful task', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.task>>>()
    const { user } = await setup({ modelList: [] }, { marketplace: true })
    api.install.mockResolvedValue({ all_installed: false, task_id: 'install-task' })
    api.task.mockReturnValue(pending.promise)
    await user.click(installButton())
    await waitFor(() =>
      expect(api.task).toHaveBeenCalledExactlyOnceWith({ params: { task_id: 'install-task' } }),
    )
    expect(screen.getByRole('button', { name: /installing OpenAI$/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('button', { name: /selector.install Anthropic$/ }))
    expect(api.install).toHaveBeenCalledTimes(1)
    expect(api.summary).not.toHaveBeenCalled()
    api.summary.mockResolvedValue(installedSummary())
    await act(async () => pending.resolve(taskResponse('success')))
    expect(await screen.findByRole('region', { name: 'OpenAI' })).toBeInTheDocument()
  })

  it('allows retry after a failed task without refreshing the provider catalog', async () => {
    const { user } = await setup({ modelList: [] }, { marketplace: true })
    api.install.mockResolvedValue({ all_installed: false, task_id: 'install-task' })
    api.task.mockResolvedValue(taskResponse('failed'))
    api.catalog.mockClear()
    await user.click(installButton())
    await waitFor(() => expect(api.task).toHaveBeenCalled())
    await waitFor(() => expect(installButton()).toBeEnabled())
    expect(api.summary).not.toHaveBeenCalled()
    expect(api.catalog).not.toHaveBeenCalled()
    api.task.mockResolvedValue(taskResponse('success'))
    api.summary.mockResolvedValue(installedSummary())
    await user.click(installButton())
    expect(await screen.findByRole('region', { name: 'OpenAI' })).toBeInTheDocument()
  })

  it.each(['lookup failure', 'missing package'])(
    'recovers from %s without starting installation',
    async (failure) => {
      const { user } = await setup({ modelList: [] }, { marketplace: true })
      if (failure === 'lookup failure') api.lookup.mockRejectedValue(new Error('Not found'))
      else
        api.lookup.mockResolvedValue({
          data: {
            plugin: { category: 'model', latest_package_identifier: '', latest_version: '1.0.0' },
            version: { version: '1.0.0' },
          },
        })
      await user.click(installButton())
      await waitFor(() => expect(installButton()).toBeEnabled())
      expect(api.install).not.toHaveBeenCalled()
      expect(api.summary).not.toHaveBeenCalled()
    },
  )
})

describe('credentials in the model selector', () => {
  const modelList = [catalog[0]!]
  const credentialDialog = () =>
    screen.findByRole('dialog', {
      name: 'modelProvider.modelProvider.auth.apiKeyModal.title',
    })

  it('exposes model suggestions in the accessible option name', async () => {
    await setup({
      modelList,
      modelSuggestionPredicate: (_provider, item) => item.model === 'gpt-4',
    })
    expect(
      screen.getByRole('button', {
        name: /gpt-4.*modelProvider.modelProvider.selector.suggestionTip/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GPT 5.4 Mini' })).toBeInTheDocument()
  })

  it('adds a provider credential from an unconfigured model and refreshes its displayed credential', async () => {
    const unconfigured = [provider(OPENAI, 'OpenAI', [model('gpt-4', { status: 'no-configure' })])]
    const summary = summaryFor(unconfigured)
    summary.data[0]!.custom_configuration = {
      status: 'no-configure',
      available_credentials: [],
      current_credential_usable: false,
      has_custom_models: false,
    }
    const { user, onSelect } = await setup(
      { modelList: unconfigured },
      {
        summary,
        permissions: ['credential.create'],
      },
    )
    expect(screen.getByRole('button', { name: /selector.configureRequired/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'COMMON.OPERATION.ADD' }))
    const dialog = await credentialDialog()
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'New key',
    )
    await user.type(within(dialog).getByLabelText('API key', { exact: false }), 'new-secret')
    const updated = summaryFor(unconfigured)
    updated.data[0]!.custom_configuration.current_credential_name = 'New key'
    api.summary.mockResolvedValue(updated)
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(api.addCredential).toHaveBeenCalledWith({
      params: { provider: OPENAI },
      body: { credentials: { api_key: 'new-secret' }, name: 'New key', credential_id: undefined },
    })
    await user.click(screen.getByRole('button', { name: 'Selected model' }))
    expect(await screen.findByRole('button', { name: 'New key' })).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('lets a manage-only user edit the real credential without offering use or creation', async () => {
    const { user } = await setup({ modelList }, { permissions: ['credential.manage'] })
    await user.click(screen.getByRole('button', { name: 'Workspace key' }))
    const edit = await screen.findByRole('button', { name: 'common.operation.edit' })
    expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Workspace key', pressed: true }),
    ).not.toBeInTheDocument()
    await user.click(edit)
    const dialog = await credentialDialog()
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument())
    const name = await within(dialog).findByRole('textbox', {
      name: 'plugin.auth.authorizationName',
    })
    expect(name).toHaveValue('Workspace key')
    await user.clear(name)
    await user.type(name, 'Renamed key')
    const updated = summaryFor(modelList)
    updated.data[0]!.custom_configuration.current_credential_name = 'Renamed key'
    api.summary.mockResolvedValue(updated)
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(api.credential).toHaveBeenCalledWith({
      params: { provider: OPENAI },
      query: { credential_id: 'key-1' },
    })
    expect(api.editCredential).toHaveBeenCalledWith({
      params: { provider: OPENAI },
      body: {
        credential_id: 'key-1',
        name: 'Renamed key',
        credentials: { api_key: '[__HIDDEN__]' },
      },
    })
    expect(api.addCredential).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Selected model' }))
    expect(await screen.findByRole('button', { name: 'Renamed key' })).toBeInTheDocument()
  })

  it('keeps model selection available without permission to manage provider credentials', async () => {
    const { user, onSelect } = await setup({ modelList }, { permissions: [] })
    expect(screen.getByRole('button', { name: 'Workspace key' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))
    expect(onSelect).toHaveBeenCalledWith(OPENAI, expect.objectContaining({ model: 'gpt-4' }))
    expect(api.providers).not.toHaveBeenCalled()
  })
})
