import type { Dependency } from '@/app/components/plugins/types'
import type { consoleClient } from '@/service/console'
import { zAppProviderAgentToolResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Cookies from 'js-cookie'
import CommonLayoutError from '@/app/(commonLayout)/error'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '@/app/components/detail-sidebar/cookie'
import { PermissionType } from '@/app/components/plugins/types'
import { useStore as usePluginDependenciesStore } from '@/app/components/workflow/plugin-dependency/store'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  createProviderSummaryFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { AppACLPermission } from '@/utils/permission'
import Configuration from '../index'
import { toast as configurationToast } from '../toast'

const flags = vi.hoisted(() => ({ agentV2: false }))
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      get NEXT_PUBLIC_ENABLE_AGENT_V2() {
        return flags.agentV2
      },
    },
  }
})

const api = vi.hoisted(() => ({
  app: vi.fn<typeof consoleClient.apps.byAppId.get>(),
  publish: vi.fn<typeof consoleClient.apps.byAppId.modelConfig.post>(),
  tools: vi.fn<typeof consoleClient.workspaces.current.toolProviders.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  rules:
    vi.fn<
      typeof consoleClient.workspaces.current.modelProviders.byProvider.models.parameterRules.get
    >(),
  stream: vi.fn<typeof import('@/service/base').ssePost>(),
  marketplace: vi.fn<typeof import('@/service/base').postMarketplace>(),
  install: vi.fn<typeof consoleClient.workspaces.current.plugin.install.marketplace.post>(),
  models: vi.fn<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>(),
  modelSummary: vi.fn<typeof consoleClient.workspaces.current.modelProviders.summary.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.get': (input) => api.app(input),
      'apps.byAppId.modelConfig.post': (input) => api.publish(input),
      'datasets.get': (input) => api.datasets(input),
      'codeBasedExtension.get': async () => ({ data: [] }),
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.toolProviders.get': (input) => api.tools(input),
      'workspaces.current.models.modelTypes.byModelType.get': (input) => api.models(input),
      'workspaces.current.modelProviders.summary.get': (input) => api.modelSummary(input),
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': (input) =>
        api.rules(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.install.marketplace.post': (input) => api.install(input),
      'apps.byAppId.get': (input) => api.app(input),
      'apps.byAppId.modelConfig.post': (input) => api.publish(input),
      'workspaces.current.toolProviders.get': (input) => api.tools(input),
      'datasets.get': (input) => api.datasets(input),
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': (input) =>
        api.rules(input),
    }),
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: api.stream,
  postMarketplace: api.marketplace,
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/configuration',
}))

const createApp = (overrides: Parameters<typeof createAppDetailFixture>[0] = {}) =>
  createAppDetailFixture({
    id: 'app-1',
    name: 'Configuration test',
    mode: 'chat',
    permission_keys: [
      AppACLPermission.Edit,
      AppACLPermission.ReleaseAndVersion,
      AppACLPermission.TestAndRun,
    ],
    model_config: createAppModelConfigFixture({
      updated_at: 1710000000,
      prompt_type: 'simple',
      pre_prompt: 'Explain concepts clearly.',
      model: {
        provider: 'langgenius/openai/openai',
        name: 'gpt-4',
        mode: 'chat',
        completion_params: { temperature: 0.7 },
      },
    }),
    ...overrides,
  })
function setup({ app = createApp() }: { app?: ReturnType<typeof createApp> } = {}) {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, app)
  const catalog = createModelCatalogFixture({
    provider: 'langgenius/openai/openai',
    models: [
      createCatalogModelFixture({
        model_properties: { mode: 'chat' },
        features: ['vision'],
      }),
      createCatalogModelFixture({
        model: 'gpt-instruct',
        label: { en_US: 'GPT Instruct' },
        model_properties: { mode: 'completion' },
      }),
      createCatalogModelFixture({
        model: 'gpt-4.1',
        label: { en_US: 'GPT-4.1' },
        model_properties: { mode: 'chat' },
        features: ['vision'],
      }),
    ],
  })
  seedModelProviderQueries(queryClient, [catalog])
  api.models.mockImplementation(async ({ params }) => ({
    data: params.model_type === 'llm' ? [zProviderWithModelsResponse.parse(catalog)] : [],
  }))
  api.modelSummary.mockResolvedValue({
    data: [createProviderSummaryFixture({ provider: catalog.provider, label: catalog.label })],
    plugins: {},
  })
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const { wrapper: UrlState } = createNuqsTestWrapper()
  renderWithConsoleQuery(
    <UrlState>
      <EventEmitterContextProvider>
        <ErrorBoundary fallback={(error) => <CommonLayoutError error={error} retry={() => {}} />}>
          <Configuration />
        </ErrorBoundary>
        <AppToastHost />
      </EventEmitterContextProvider>
    </UrlState>,
    {
      queryClient,
      currentWorkspace: { id: 'workspace-1' },
      workspacePermissionKeys: ['app.create_and_management', 'plugin.install'],
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: true,
        plugin_installation_permission: {
          plugin_installation_scope: 'all',
          restrict_to_marketplace_only: false,
        },
      },
    },
  )
  return { user: userEvent.setup() }
}
const prompt = () => screen.getByRole('textbox', { name: 'appDebug.chatSubTitle' })
const waitForPage = () => screen.findByRole('heading', { name: 'appDebug.orchestrate' })
async function openPublisher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
}
async function publish(user: ReturnType<typeof userEvent.setup>) {
  const previousCalls = api.publish.mock.calls.length
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.publishUpdate' }))
  await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(previousCalls + 1))
  await screen.findByRole('button', { name: 'workflow.common.published' })
}
async function enableComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
  )
  await user.click(screen.getByRole('button', { name: 'appDebug.debugAsMultipleModel' }))
  await screen.findByRole('button', { name: /modelProvider.modelProvider.addModel/ })
}
beforeEach(() => {
  flags.agentV2 = false
  usePluginDependenciesStore.setState({ dependencies: [] })
  for (const mock of Object.values(api)) mock.mockReset()
  Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
  api.app.mockResolvedValue(createApp())
  api.publish.mockResolvedValue({ result: 'success' })
  api.tools.mockResolvedValue([])
  api.datasets.mockResolvedValue({ data: [], has_more: false, limit: 20, page: 1, total: 0 })
  api.rules.mockResolvedValue({
    data: [
      {
        name: 'temperature',
        label: { en_US: 'Temperature' },
        type: 'float',
        default: 0.7,
        min: 0,
        max: 2,
        required: false,
        options: [],
      },
    ],
  })
  api.stream.mockResolvedValue(undefined)
  api.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.marketplace.mockReset()
})
afterEach(() =>
  act(() => {
    toast.dismiss()
    configurationToast.dismiss()
    vi.unstubAllGlobals()
  }),
)

it('loads the actual configuration page before editing and publishing a prompt', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof consoleClient.apps.byAppId.get>>>()
  api.app.mockReturnValueOnce(request.promise)
  const { user } = setup()
  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await act(async () => request.resolve(createApp()))
  await waitForPage()
  expect(prompt()).toHaveTextContent('Explain concepts clearly.')
  await user.type(prompt(), ' Answer in one sentence.')
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    params: { app_id: 'app-1' },
    body: {
      pre_prompt: 'Explain concepts clearly. Answer in one sentence.',
      model: { name: 'gpt-4', completion_params: { temperature: 0.7 } },
    },
  })
})

it('restores the last successful publication after cancelling an earlier restore', async () => {
  const { user } = setup()
  await waitForPage()
  await user.type(prompt(), ' Published revision.')
  await publish(user)
  await user.keyboard('{Escape}')
  await user.type(prompt(), ' Unpublished revision.')
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  const confirmation = await screen.findByRole('alertdialog', {
    name: 'appDebug.resetConfig.title',
  })
  await user.click(within(confirmation).getByRole('button', { name: 'common.operation.cancel' }))
  expect(prompt()).toHaveTextContent('Unpublished revision.')
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  await user.click(
    within(
      await screen.findByRole('alertdialog', { name: 'appDebug.resetConfig.title' }),
    ).getByRole('button', { name: 'common.operation.confirm' }),
  )
  expect(prompt()).toHaveTextContent('Explain concepts clearly. Published revision.')
  expect(prompt()).not.toHaveTextContent('Unpublished revision.')
  expect(api.publish).toHaveBeenCalledTimes(1)
})

it.each([
  { permission: AppACLPermission.ViewLayout, editable: false, runnable: false, publishable: false },
  { permission: AppACLPermission.Edit, editable: true, runnable: false, publishable: false },
  { permission: AppACLPermission.TestAndRun, editable: false, runnable: true, publishable: false },
  {
    permission: AppACLPermission.ReleaseAndVersion,
    editable: false,
    runnable: false,
    publishable: true,
  },
])(
  'enforces independent edit, run, and release permissions for $permission',
  async ({ permission, editable, runnable, publishable }) => {
    const app = createApp({ permission_keys: [permission] })
    api.app.mockResolvedValue(app)
    const { user } = setup({ app })
    await waitForPage()
    expect(prompt()).toHaveAttribute('contenteditable', String(editable))
    const send = screen.getByRole('button', { name: 'common.operation.send' })
    if (runnable) {
      await user.type(screen.getByPlaceholderText(/^common.chat.inputPlaceholder/), 'Explain RAG')
      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
      expect(api.stream).toHaveBeenCalledWith(
        'apps/app-1/chat-messages',
        expect.objectContaining({ body: expect.objectContaining({ query: 'Explain RAG' }) }),
        expect.anything(),
      )
    } else {
      expect(send).toBeDisabled()
      expect(api.stream).not.toHaveBeenCalled()
    }
    if (publishable) {
      await publish(user)
      expect(api.publish.mock.lastCall![0]).toMatchObject({
        body: { pre_prompt: 'Explain concepts clearly.' },
      })
    } else {
      expect(screen.getByRole('button', { name: 'workflow.common.publish' })).toBeDisabled()
      expect(api.publish).not.toHaveBeenCalled()
    }
  },
)

it('selects another model and publishes only parameters supported by that model', async () => {
  const { user } = setup()
  await waitForPage()
  api.rules.mockResolvedValue({ data: [] })
  await user.click(screen.getByRole('button', { name: /^GPT-4 CHAT$/ }))
  const chooser = await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' })
  await user.click(within(chooser).getByRole('button', { name: /^GPT-4.1/ }))
  await screen.findByText(/modelProvider.modelProvider.parametersInvalidRemoved/)
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: { model: { name: 'gpt-4.1' } },
  })
  expect(api.publish.mock.lastCall![0].body.model.completion_params).toEqual({})
})

it('keeps comparison mode when restoring the published prompt', async () => {
  const { user } = setup()
  await waitForPage()
  await enableComparison(user)
  const addModel = await screen.findByRole('button', {
    name: /modelProvider.modelProvider.addModel/,
  })
  expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
  await user.type(prompt(), ' Draft.')
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  await user.click(
    within(
      await screen.findByRole('alertdialog', { name: 'appDebug.resetConfig.title' }),
    ).getByRole('button', { name: 'common.operation.confirm' }),
  )
  expect(prompt()).toHaveTextContent('Explain concepts clearly.')
  expect(prompt()).not.toHaveTextContent('Draft.')
  expect(addModel).toBeVisible()
})

it('publishes the selected comparison model and restores its parameters as the published snapshot', async () => {
  const { user } = setup()
  await waitForPage()
  await enableComparison(user)
  await user.click(screen.getByRole('button', { name: /modelProvider.modelProvider.selectModel/ }))
  const settings = await screen.findByRole('dialog', {
    name: 'modelProvider.modelProvider.modelSettings',
  })
  await user.click(
    within(settings).getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
  )
  await user.click(
    within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    ).getByRole('button', { name: /^GPT-4.1/ }),
  )
  const modelSettings = await screen.findByRole('dialog', {
    name: 'modelProvider.modelProvider.modelSettings',
  })
  await user.click(within(modelSettings).getByRole('switch', { name: 'Temperature' }))
  await user.clear(within(modelSettings).getByRole('spinbutton', { name: 'Temperature' }))
  await user.type(within(modelSettings).getByRole('spinbutton', { name: 'Temperature' }), '0.2')
  await user.click(within(modelSettings).getByRole('button', { name: 'common.operation.close' }))
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'appDebug.operation.applyConfig' }))
  await user.click(screen.getByRole('menuitem', { name: /GPT-4.1/ }))
  await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1))
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: { model: { name: 'gpt-4.1', completion_params: { temperature: 0.2 } } },
  })
  await user.keyboard('{Escape}')
  await user.keyboard('{Escape}')
  await user.click(screen.getAllByRole('button', { name: 'common.operation.more' })[0]!)
  await user.click(screen.getByRole('menuitem', { name: 'appDebug.debugAsSingleModel' }))
  expect(screen.getByRole('button', { name: /^GPT-4 CHAT$/ })).toBeVisible()
  await user.type(prompt(), ' Unsaved draft.')
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  await user.click(
    within(
      await screen.findByRole('alertdialog', { name: 'appDebug.resetConfig.title' }),
    ).getByRole('button', { name: 'common.operation.confirm' }),
  )
  expect(screen.getByRole('button', { name: /^GPT-4.1/ })).toBeVisible()
  expect(prompt()).not.toHaveTextContent('Unsaved draft.')
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: { model: { name: 'gpt-4.1', completion_params: { temperature: 0.2 } } },
  })
})

it('loads and publishes persisted advanced messages with their roles intact', async () => {
  const app = createApp({
    model_config: createAppModelConfigFixture({
      ...createApp().model_config,
      prompt_type: 'advanced',
      chat_prompt_config: {
        prompt: [
          { role: 'system', text: 'Answer with sources.' },
          { role: 'user', text: 'Explain RAG.' },
        ],
      },
    }),
  })
  api.app.mockResolvedValue(app)
  const { user } = setup({ app })
  await waitForPage()
  expect(screen.getByText('Answer with sources.')).toBeVisible()
  expect(screen.getByText('Explain RAG.')).toBeVisible()
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: {
      prompt_type: 'advanced',
      chat_prompt_config: {
        prompt: [
          { role: 'system', text: 'Answer with sources.' },
          { role: 'user', text: 'Explain RAG.' },
        ],
      },
    },
  })
})

it('shows the page error fallback for a missing model configuration', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    api.app.mockResolvedValue(createApp({ model_config: undefined }))
    setup()
    expect(
      await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'appDebug.orchestrate' })).not.toBeInTheDocument()
  } finally {
    report.mockRestore()
  }
})

it('keeps the redirect loading fallback when configuration dependencies return unauthorized', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const request =
      createDeferred<
        Awaited<ReturnType<typeof consoleClient.workspaces.current.toolProviders.get>>
      >()
    api.tools.mockReturnValue(request.promise)
    setup()
    await act(async () => request.reject(createHttpError(new Response(null, { status: 401 }))))
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'appDebug.orchestrate' })).not.toBeInTheDocument()
  } finally {
    report.mockRestore()
  }
})

it('preserves feature drafts across reopening and restores the last published features', async () => {
  const { user } = setup()
  await waitForPage()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' }))
  const panel = await screen.findByRole('dialog', { name: 'workflow.common.features' })
  await user.click(
    within(panel).getByRole('switch', {
      name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title',
    }),
  )
  await user.click(within(panel).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.features' }),
    ).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.manage' }))
  const reopened = await screen.findByRole('dialog', { name: 'workflow.common.features' })
  expect(
    within(reopened).getByRole('switch', {
      name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title',
    }),
  ).toBeChecked()
  await user.click(within(reopened).getByRole('button', { name: 'common.operation.close' }))
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: { suggested_questions_after_answer: { enabled: true } },
  })
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.manage' }))
  const draftPanel = await screen.findByRole('dialog', { name: 'workflow.common.features' })
  await user.click(
    within(draftPanel).getByRole('switch', {
      name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title',
    }),
  )
  await user.click(within(draftPanel).getByRole('button', { name: 'common.operation.close' }))
  expect(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' })).toBeVisible()
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  await user.click(
    within(
      await screen.findByRole('alertdialog', { name: 'appDebug.resetConfig.title' }),
    ).getByRole('button', { name: 'common.operation.confirm' }),
  )
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.manage' }))
  expect(
    within(await screen.findByRole('dialog', { name: 'workflow.common.features' })).getByRole(
      'switch',
      { name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title' },
    ),
  ).toBeChecked()
  expect(api.publish).toHaveBeenCalledTimes(1)
})

it('opens and closes the mobile debug drawer while preserving the configuration draft', async () => {
  vi.stubGlobal('innerWidth', 390)
  const { user } = setup()
  await waitForPage()
  await user.type(prompt(), ' Mobile draft.')
  const openDebug = () =>
    user.click(screen.getByRole('button', { name: 'appDebug.operation.debugConfig' }))
  await openDebug()
  const drawer = await screen.findByRole('dialog')
  const composer = await within(drawer).findByRole('textbox')
  await user.type(composer, 'Try this draft')
  expect(composer).toHaveValue('Try this draft')
  await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(prompt()).toHaveTextContent('Mobile draft.')
  await openDebug()
  expect(await within(await screen.findByRole('dialog')).findByRole('textbox')).toBeInTheDocument()
})

it.each([false, true])(
  'shows the legacy Agent migration entry only with Agent v2 enabled=%s',
  async (enabled) => {
    flags.agentV2 = enabled
    const app = createApp({ mode: 'agent-chat' })
    api.app.mockResolvedValue(app)
    const { user } = setup({ app })
    await waitForPage()
    const badge = screen.queryByRole('button', { name: 'appDebug.legacyAgentBadge.label' })
    if (!enabled) {
      expect(badge).not.toBeInTheDocument()
      return
    }
    await user.click(screen.getByRole('button', { name: 'appDebug.legacyAgentBadge.label' }))
    expect(await screen.findByText('appDebug.legacyAgentBadge.description')).toBeVisible()
    expect(screen.getByRole('link', { name: /appDebug.legacyAgentBadge.action/ })).toHaveAttribute(
      'href',
      '/agents',
    )
  },
)

it.each([true, false])(
  'updates removed Agent tools after dependency installation succeeds=%s',
  async (success) => {
    const plugin = createMarketplacePluginFixture({
      org: 'vendor',
      name: 'search',
      plugin_id: 'vendor/search',
      latest_package_identifier: 'vendor/search:1.0.0',
      label: { en_US: 'Search plugin' },
    })
    const unselectedPlugin = createMarketplacePluginFixture({
      org: 'vendor',
      name: 'reference',
      plugin_id: 'vendor/reference',
      latest_package_identifier: 'vendor/reference:1.0.0',
      label: { en_US: 'Reference plugin' },
    })
    const providerId = 'vendor/search/search'
    const tool = zAppProviderAgentToolResponse.parse({
      provider_id: providerId,
      provider_name: providerId,
      provider_type: 'builtin',
      tool_name: 'search',
      tool_label: 'Search the web',
      tool_parameters: {},
      enabled: true,
    })
    const unselectedTool = {
      ...tool,
      provider_id: 'vendor/reference/reference',
      provider_name: 'vendor/reference/reference',
      tool_name: 'lookup',
      tool_label: 'Read reference',
    }
    const tools = [tool, unselectedTool]
    const base = createApp()
    const app = createApp({
      mode: 'agent-chat',
      deleted_tools: tools.map((tool) => ({
        provider_id: tool.provider_id,
        tool_name: tool.tool_name,
        type: 'builtin',
      })),
      model_config: { ...base.model_config!, agent_mode: { enabled: true, tools } },
    })
    api.app.mockResolvedValue(app)
    api.marketplace.mockResolvedValue({
      data: { list: [plugin, unselectedPlugin].map((plugin) => ({ plugin })) },
    })
    if (!success) api.install.mockRejectedValue(new Error('Installation rejected'))
    const { user } = setup({ app })
    await waitForPage()
    expect(screen.getAllByRole('button', { name: 'tools.toolRemoved' })).toHaveLength(2)
    const dependencies: Dependency[] = [plugin, unselectedPlugin].map((plugin) => ({
      type: 'marketplace',
      value: { marketplace_plugin_unique_identifier: plugin.latest_package_identifier },
    }))
    act(() => usePluginDependenciesStore.getState().setDependencies(dependencies))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
    const install = within(dialog).getByRole('button', { name: 'plugin.installModal.install' })
    await waitFor(() => expect(install).toBeEnabled())
    await user.click(within(dialog).getByRole('checkbox', { name: 'reference' }))
    await user.click(install)
    await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
    expect(api.install).toHaveBeenCalledExactlyOnceWith({
      body: { plugin_unique_identifiers: [plugin.latest_package_identifier] },
    })
    await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'tools.toolRemoved' })).toHaveLength(
      success ? 1 : 2,
    )
    if (success) expect(screen.getByRole('button', { name: 'search' })).toBeInTheDocument()
    else expect(screen.queryByRole('button', { name: 'search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'lookup' })).not.toBeInTheDocument()
  },
)

it('adds a prompt variable, edits its label, and publishes the actual form schema', async () => {
  const { user } = setup()
  await waitForPage()
  await user.click(prompt())
  await user.paste('Explain {{topic}} clearly.')
  await user.tab()
  const confirmation = await screen.findByRole('group', { name: 'appDebug.autoAddVar' })
  await user.click(within(confirmation).getByRole('button', { name: 'common.operation.add' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  const label = within(dialog).getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Discussion topic')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: {
      pre_prompt: expect.stringContaining('{{topic}}'),
      user_input_form: [{ 'text-input': { variable: 'topic', label: 'Discussion topic' } }],
    },
  })
})

it('edits advanced completion history prefixes through the page and publishes them', async () => {
  const app = createApp({
    model_config: createAppModelConfigFixture({
      ...createApp().model_config,
      model: {
        provider: 'langgenius/openai/openai',
        name: 'gpt-instruct',
        mode: 'completion',
        completion_params: {},
      },
      prompt_type: 'advanced',
      completion_prompt_config: {
        prompt: { text: 'Answer accurately. {{#histories#}} {{#query#}}' },
        conversation_histories_role: { user_prefix: 'Human', assistant_prefix: 'Assistant' },
      },
    }),
  })
  api.app.mockResolvedValue(app)
  const { user } = setup({ app })
  await waitForPage()
  expect(
    screen.getByRole('heading', { name: 'appDebug.feature.conversationHistory.title' }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'appDebug.feature.conversationHistory.editModal.title',
  })
  const userPrefix = within(dialog).getByDisplayValue('Human')
  await user.clear(userPrefix)
  await user.type(userPrefix, 'Customer')
  await user.clear(within(dialog).getByDisplayValue('Assistant'))
  await user.type(
    within(dialog).getByPlaceholderText('common.chat.conversationNamePlaceholder'),
    'Expert',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await publish(user)
  expect(api.publish.mock.lastCall![0]).toMatchObject({
    body: {
      prompt_type: 'advanced',
      completion_prompt_config: {
        conversation_histories_role: { user_prefix: 'Customer', assistant_prefix: 'Expert' },
      },
    },
  })
})
