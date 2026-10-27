import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { trackEvent } from '@/app/components/base/amplitude/utils'
import type { consoleClient } from '@/service/console'
import type { marketplaceClient } from '@/service/marketplace'
import type { fetchMarketplaceTemplateDSL } from '@/service/marketplace-templates'
import { zAppPagination, zImport } from '@dify/contracts/api/console/apps/zod.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createTrialAppDetailFixture } from '@/test/fixtures/app'
import { rememberCreateAppExternalAttribution } from '@/utils/create-app-tracking'
import { Apps } from '../index'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.explore.apps.byAppId.get>(),
  trial: vi.fn<typeof consoleClient.trialApps.byAppId.get>(),
  import: vi.fn<typeof consoleClient.apps.imports.post>(),
  confirm: vi.fn<typeof consoleClient.apps.imports.byImportId.confirm.post>(),
  dependencies: vi.fn<typeof consoleClient.apps.imports.byAppId.checkDependencies.get>(),
  dsl: vi.fn<typeof fetchMarketplaceTemplateDSL>(),
  track: vi.fn<typeof trackEvent>(),
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push, replace: api.replace }),
  useParams: () => ({}),
  usePathname: () => '/apps',
  useSearchParams: () => api.params,
}))
vi.mock('@/app/components/base/amplitude/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude/utils')>()),
  trackEvent: api.track,
}))
vi.mock('@/service/marketplace-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/marketplace-templates')>()),
  fetchMarketplaceTemplateDSL: api.dsl,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': async () =>
        zAppPagination.parse({ data: [], page: 1, limit: 30, total: 0, has_more: false }),
      'apps.starred.get': async () =>
        zAppPagination.parse({ data: [], page: 1, limit: 100, total: 0, has_more: false }),
      'trialApps.byAppId.get': api.trial,
      'features.get': async () => zGetFeaturesResponse.parse({ apps: { size: 1, limit: 10 } }),
      'tags.get': async () => [],
      'workspaces.current.members.get': async () => ({ accounts: [] }),
      'workspaces.current.toolProviders.get': async () => [],
      'apps.imports.post': api.import,
      'apps.imports.byImportId.confirm.post': api.confirm,
      'apps.imports.byAppId.checkDependencies.get': api.dependencies,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'explore.apps.byAppId.get': api.detail,
    }),
  }
})

const template = {
  app_id: 'canonical-template',
  app: {
    id: 'different-nested-id',
    name: 'Sample App',
    mode: 'chat',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
    icon_url: null,
  },
  description: 'Catalog description',
  can_trial: true,
} satisfies RecommendedAppResponse
const detail = {
  id: 'canonical-template',
  name: 'Sample App',
  mode: 'chat',
  can_trial: true,
  export_data: 'fresh-dsl',
} satisfies Awaited<ReturnType<typeof api.detail>>
const completed = zImport.parse({
  id: 'import-1',
  status: 'completed',
  app_id: 'created-app',
  app_mode: 'chat',
  permission_keys: ['app.acl.edit'],
})
const marketplaceTemplate = {
  data: {
    id: 'tpl-42',
    template_name: 'Marketplace template',
    overview: 'A useful template',
    icon: '🤖',
    icon_background: '#fff',
    icon_file_key: '',
    publisher_unique_handle: 'langgenius',
    usage_count: 12,
    categories: [],
  },
} satisfies Awaited<ReturnType<typeof marketplaceClient.templateDetail>>

beforeEach(() => {
  api.params = new URLSearchParams()
  api.push.mockReset()
  api.replace.mockReset()
  api.track.mockReset()
  api.dsl.mockReset().mockResolvedValue('marketplace-dsl')
  api.detail.mockReset().mockResolvedValue(detail)
  api.trial
    .mockReset()
    .mockResolvedValue(createTrialAppDetailFixture({ id: template.app_id, name: 'Sample App' }))
  api.import.mockReset().mockResolvedValue(completed)
  api.confirm.mockReset().mockResolvedValue(completed)
  api.dependencies.mockReset().mockResolvedValue({ leaked_dependencies: [] })
  sessionStorage.clear()
})
afterEach(() => act(() => toast.dismiss()))

async function setup({
  cloud = false,
  permission = true,
  item = template,
}: { cloud?: boolean; permission?: boolean; item?: RecommendedAppResponse } = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(
    consoleQuery.explore.apps.learnDify.get.queryKey({ input: { query: { language: 'en-US' } } }),
    { recommended_apps: [item] },
  )
  queryClient.setQueryData(
    consoleQuery.explore.apps.byAppId.get.queryKey({
      input: { params: { app_id: template.app_id } },
    }),
    { ...detail, export_data: 'stale-dsl' },
  )
  queryClient.setQueryData(
    marketplaceQuery.templateDetail.queryKey({ input: { params: { templateId: 'tpl-42' } } }),
    marketplaceTemplate,
  )
  await act(async () =>
    renderWithConsoleQuery(
      <NuqsTestingAdapter hasMemory searchParams={api.params}>
        <Apps />
        <AppToaster timeout={0} />
      </NuqsTestingAdapter>,
      {
        queryClient,
        workspacePermissionKeys: permission ? ['app.create_and_management'] : [],
        systemFeatures: {
          deployment_edition: cloud ? 'CLOUD' : 'COMMUNITY',
          enable_learn_app: true,
          rbac_enabled: true,
          enable_collaboration_mode: false,
        },
        features: { apps: { size: 0, limit: 10 } },
      },
    ),
  )
  return { user: userEvent.setup() }
}
const openCreate = async (user: ReturnType<typeof userEvent.setup>, preview = false) => {
  await user.click(await screen.findByRole('button', { name: 'Sample App' }))
  if (preview) {
    const previewDialog = await screen.findByRole(
      'dialog',
      { name: 'Sample App' },
      { timeout: 5000 },
    )
    await user.click(
      await within(previewDialog).findByRole('button', {
        name: 'explore.tryApp.createFromSampleApp',
      }),
    )
  }
  return screen.findByRole('dialog', { name: /^explore.appCustomize.title/ })
}
const submit = async (user: ReturnType<typeof userEvent.setup>) => {
  const form = screen.getByRole('dialog', { name: /^explore.appCustomize.title/ })
  await user.click(within(form).getByRole('button', { name: /^common.operation.create/ }))
}
const expectCreateEvent = (source: string, templateId = template.app_id) =>
  expect(api.track).toHaveBeenCalledWith(
    'create_app',
    expect.objectContaining({ source, template_id: templateId, app_mode: 'chatflow' }),
  )
const expectNoCreateEvent = () =>
  expect(api.track).not.toHaveBeenCalledWith('create_app', expect.anything())

it('imports fresh canonical detail through the real list and form, then checks dependencies and navigates', async () => {
  const { user } = await setup()
  const dialog = await openCreate(user)
  expect(within(dialog).getByPlaceholderText('app.newApp.appDescriptionPlaceholder')).toHaveValue(
    '',
  )
  await submit(user)
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/app/created-app/configuration'))
  expect(api.detail).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'canonical-template' } })
  expect(api.import).toHaveBeenCalledWith({
    body: expect.objectContaining({
      yaml_content: 'fresh-dsl',
      name: 'Sample App',
      description: '',
    }),
  })
  expect(api.dependencies).toHaveBeenCalledWith({ params: { app_id: 'created-app' } })
  expect(await screen.findByText('app.newApp.appCreated')).toBeInTheDocument()
})

it('keeps a reopened creation form pending until the previous import finishes its dependency check', async () => {
  let resolveDependencies: (value: Awaited<ReturnType<typeof api.dependencies>>) => void = () => {}
  api.dependencies.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDependencies = resolve
      }),
  )
  const { user } = await setup()
  await openCreate(user)
  await submit(user)
  await waitFor(() => expect(api.dependencies).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: /^explore.appCustomize.title/ }),
    ).not.toBeInTheDocument(),
  )
  const reopened = await openCreate(user)
  const create = within(reopened).getByRole('button', { name: /^common.operation.create/ })
  expect(create).toHaveAttribute('aria-disabled', 'true')
  await user.click(create)
  expect(api.import).toHaveBeenCalledOnce()
  await act(async () => resolveDependencies({ leaked_dependencies: [] }))
  await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled', 'true'))
})

it('tracks creation through the real preview and closes it after submission', async () => {
  const { user } = await setup({ cloud: true })
  await openCreate(user, true)
  await submit(user)
  await waitFor(() => expectCreateEvent('studio_template_preview'))
  expect(screen.queryByRole('dialog', { name: 'Sample App' })).not.toBeInTheDocument()
  expect(api.push).toHaveBeenCalledWith('/app/created-app/configuration')
})

it('shows a detail error once without importing or navigating, and preserves the submitted form', async () => {
  api.detail.mockRejectedValue(new Error('Unavailable'))
  const { user } = await setup()
  await openCreate(user)
  await submit(user)
  expect(await screen.findAllByText('app.newApp.appCreateFailed')).toHaveLength(1)
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: /^explore.appCustomize.title/ }),
    ).toBeInTheDocument(),
  )
  expect(api.detail).toHaveBeenCalledOnce()
  expect(api.import).not.toHaveBeenCalled()
  expect(api.push).not.toHaveBeenCalled()
  expectNoCreateEvent()
})

it('waits for version confirmation before importing and tracking preview creation', async () => {
  api.import.mockResolvedValue(
    zImport.parse({
      id: 'import-1',
      status: 'pending',
      imported_dsl_version: '0.8.0',
      current_dsl_version: '0.6.0',
    }),
  )
  const { user } = await setup({ cloud: true })
  await openCreate(user, true)
  await submit(user)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('0.8.0')).toBeInTheDocument()
  expectNoCreateEvent()
  expect(api.push).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'app.newApp.Confirm' }))
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/app/created-app/configuration'))
  expect(api.confirm).toHaveBeenCalledExactlyOnceWith({ params: { import_id: 'import-1' } })
  expectCreateEvent('studio_template_preview')
})

it.each([undefined, 'Missing app data in YAML content'])(
  'shows import failure (%s) without tracking or navigating',
  async (error) => {
    api.import.mockResolvedValue(zImport.parse({ id: 'import-1', status: 'failed', error }))
    const { user } = await setup({ cloud: true })
    await openCreate(user, true)
    await submit(user)
    expect(await screen.findAllByText('app.newApp.appCreateFailed')).toHaveLength(1)
    if (error) expect(screen.getByText(error)).toBeInTheDocument()
    expect(api.push).not.toHaveBeenCalled()
    expectNoCreateEvent()
  },
)

it('keeps nullable template metadata editable in the real creation form', async () => {
  const { user } = await setup({ item: { app_id: 'null-template', app: null, can_trial: false } })
  await user.click(await screen.findByRole('button', { name: '' }))
  const dialog = await screen.findByRole('dialog', { name: /^explore.appCustomize.title/ })
  expect(within(dialog).getByPlaceholderText('app.newApp.appNamePlaceholder')).toHaveValue('')
  expect(within(dialog).getByPlaceholderText('app.newApp.appDescriptionPlaceholder')).toHaveValue(
    '',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  expect(api.detail).not.toHaveBeenCalled()
  expect(api.import).not.toHaveBeenCalled()
})

it('hides template creation and marketplace import without creation permission', async () => {
  api.params = new URLSearchParams('template-id=tpl-42')
  await setup({ permission: false })
  await waitFor(() =>
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('app.filterEmpty.noApps'),
  )
  expect(screen.queryByRole('button', { name: 'Sample App' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.dsl).not.toHaveBeenCalled()
  expect(api.import).not.toHaveBeenCalled()
})

it('imports a real marketplace download, retains attribution, and removes only its URL parameter', async () => {
  api.params = new URLSearchParams('template-id=tpl-42&category=chat')
  rememberCreateAppExternalAttribution({
    searchParams: new URLSearchParams('utm_source=newsletter'),
  })
  const { user } = await setup()
  const dialog = await screen.findByRole('dialog', { name: 'app.marketplace.template.modalTitle' })
  expect(within(dialog).getByText('Marketplace template')).toBeInTheDocument()
  await user.click(
    within(dialog).getByRole('button', { name: 'app.marketplace.template.importConfirm' }),
  )
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/app/created-app/configuration'))
  expect(api.dsl).toHaveBeenCalledExactlyOnceWith('tpl-42')
  expect(api.import).toHaveBeenCalledWith({
    body: { mode: 'yaml-content', yaml_content: 'marketplace-dsl' },
  })
  expectCreateEvent('external', 'tpl-42')
  expect(api.track).toHaveBeenCalledWith(
    'create_app',
    expect.objectContaining({ utm_source: 'newsletter' }),
  )
  expect(api.replace).toHaveBeenCalledWith('?category=chat', { scroll: false })
})
