import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type {
  GetExploreAppsResponse,
  RecommendedAppDetailResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import Apps from '../index'

const { request, locale, toast, checkDependencies, redirect, trackCreateApp, push } = vi.hoisted(
  () => ({
    request: vi.fn(),
    locale: { value: 'en-US' },
    toast: { success: vi.fn(), error: vi.fn() },
    checkDependencies: vi.fn(),
    redirect: vi.fn(),
    trackCreateApp: vi.fn(),
    push: vi.fn(),
  }),
)
vi.mock('@/service/base', () => ({ request }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => locale.value,
}))
vi.mock('@/app/notifications', () => ({ toast }))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({ handleCheckPluginDependencies: checkDependencies }),
}))
vi.mock('@/utils/app-redirection', () => ({ getRedirection: redirect }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push }), useParams: () => ({}) }))

const createEntry = (
  name: string,
  position: number | null,
  mode = 'chat',
  category = 'Assistant',
): RecommendedAppResponse => ({
  app_id: `catalog-${name}`,
  app: {
    id: `nested-${name}`,
    name,
    mode,
    icon_type: 'emoji',
    icon: '🙂',
    icon_background: '#fff',
    icon_url: null,
  },
  can_trial: false,
  categories: [category],
  description: 'Catalog description',
  position,
})
const catalog: GetExploreAppsResponse = {
  recommended_apps: [
    createEntry('Bravo', 2, 'completion', 'Writing'),
    createEntry('Alpha', null),
    createEntry('Charlie', 1, 'workflow'),
  ],
  categories: ['Writing', 'Empty', 'Assistant'],
}
const detail: RecommendedAppDetailResponse = {
  id: 'catalog-Alpha',
  name: 'Alpha',
  mode: 'chat',
  can_trial: false,
  export_data: 'fresh-dsl',
}
const imported: Import = {
  id: 'import-1',
  status: 'completed',
  app_id: 'created-app',
  app_mode: 'chat',
  permission_keys: ['app.edit'],
}
const catalogKey = (language: string) =>
  consoleQuery.explore.apps.get.queryKey({ input: { query: { language } } })

beforeEach(() => {
  vi.clearAllMocks()
  locale.value = 'en-US'
  request.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname.replace('/console/api', '') + new URL(url).search
    if (path.startsWith('/explore/apps?')) return Response.json(catalog)
    if (path === '/explore/apps/catalog-Alpha') return Response.json(detail)
    if (path === '/apps/imports') return Response.json(imported)
    throw new Error(`Unexpected request: ${url}`)
  })
})
const renderApps = (response = catalog, permissions = ['app.create_and_management']) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(catalogKey('en-US'), response)
  const onClose = vi.fn()
  return {
    ...render(<Apps onClose={onClose} />, { queryClient, workspacePermissionKeys: permissions }),
    onClose,
  }
}
const openFirst = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole('button', { name: 'app.newApp.useTemplate' })[0]!)
  return screen.findByRole('dialog')
}

it('reuses the prewarmed canonical locale cache and sorts only the consumer view', () => {
  const { queryClient } = renderApps()
  expect(screen.getAllByTitle(/Alpha|Bravo|Charlie/).map((element) => element.textContent)).toEqual(
    ['Alpha', 'Charlie', 'Bravo'],
  )
  expect(screen.queryByRole('button', { name: 'Empty' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Writing' })).toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
  expect(queryClient.getQueryData(catalogKey('en-US'))).toEqual(catalog)
  expect(catalog.recommended_apps.map((app) => app.app_id)).toEqual([
    'catalog-Bravo',
    'catalog-Alpha',
    'catalog-Charlie',
  ])
})

it('requests a separate locale and falls back from a category absent in the new catalog', async () => {
  const user = userEvent.setup()
  const chinese: GetExploreAppsResponse = {
    recommended_apps: [createEntry('中文', 0)],
    categories: ['Assistant'],
  }
  request.mockImplementation(async () => Response.json(chinese))
  const { rerender, queryClient } = renderApps()
  await user.click(screen.getByRole('button', { name: 'Writing' }))
  expect(screen.queryByTitle('Alpha')).not.toBeInTheDocument()
  locale.value = 'zh-Hans'
  rerender(<Apps onClose={vi.fn()} />)
  await screen.findByTitle('中文')
  expect(request).toHaveBeenCalledTimes(1)
  expect(new URL(request.mock.calls[0]![0]).searchParams.get('language')).toBe('zh-Hans')
  expect(queryClient.getQueryData(catalogKey('en-US'))).toEqual(catalog)
  expect(queryClient.getQueryData(catalogKey('zh-Hans'))).toEqual(chinese)
})

it('combines real type selection with debounced case-insensitive search and restores focus on clear', async () => {
  const user = userEvent.setup()
  renderApps()
  await user.click(screen.getByRole('button', { name: 'app.typeSelector.all' }))
  await user.click(screen.getByRole('button', { name: 'app.typeSelector.chatbot' }))
  await user.keyboard('{Escape}')
  expect(screen.getByTitle('Alpha')).toBeInTheDocument()
  expect(screen.queryByTitle('Bravo')).not.toBeInTheDocument()
  const search = screen.getByRole('searchbox')
  await user.type(search, 'ALP')
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument(),
  )
  expect(screen.getByTitle('Alpha')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.clear' })[1]!)
  expect(search).toHaveFocus()
  expect(search).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Assistant' })).toBeInTheDocument()
})

it('fetches fresh detail by canonical app_id and submits the actual form with an empty initial description', async () => {
  const user = userEvent.setup()
  const { queryClient, onClose } = renderApps()
  queryClient.setQueryData(
    consoleQuery.explore.apps.byAppId.get.queryKey({
      input: { params: { app_id: 'catalog-Alpha' } },
    }),
    { ...detail, export_data: 'stale-dsl' },
  )
  await openFirst(user)
  expect(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder')).toHaveValue('')
  await user.clear(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'))
  await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'My app')
  await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(
    request.mock.calls.map(([url]) => new URL(url).pathname.replace('/console/api', '')),
  ).toEqual(['/explore/apps/catalog-Alpha', '/apps/imports'])
  expect(await request.mock.calls[1]![2].request.json()).toMatchObject({
    yaml_content: 'fresh-dsl',
    name: 'My app',
    description: '',
  })
  expect(trackCreateApp).toHaveBeenCalledWith({
    source: 'studio_template_list',
    templateId: 'catalog-Alpha',
    appMode: 'chat',
  })
  expect(checkDependencies).toHaveBeenCalledWith('created-app')
  expect(redirect).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'created-app', permission_keys: ['app.edit'] }),
    push,
    expect.any(Object),
  )
})

it('closes the submitted modal immediately and reports detail failure without import or navigation', async () => {
  const user = userEvent.setup()
  let rejectDetail: ((reason: Error) => void) | undefined
  request.mockImplementation(
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectDetail = reject
      }),
  )
  const { onClose } = renderApps()
  await openFirst(user)
  await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => rejectDetail?.(new Error('Unavailable')))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed'))
  expect(request).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
  expect(trackCreateApp).not.toHaveBeenCalled()
  expect(redirect).not.toHaveBeenCalled()
})

it('supports nullable metadata without inventing a name and requires a name before importing', async () => {
  const user = userEvent.setup()
  renderApps({
    recommended_apps: [{ app_id: 'null-app', app: null, can_trial: false }],
    categories: [],
  })
  await openFirst(user)
  expect(screen.getByPlaceholderText('app.newApp.appNamePlaceholder')).toHaveValue('')
  expect(screen.getByRole('button', { name: /common\.operation\.create/ })).toBeDisabled()
  expect(request).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('does not expose creation actions without app management permission', () => {
  renderApps(catalog, [])
  expect(screen.getByTitle('Alpha')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'app.newApp.useTemplate' })).not.toBeInTheDocument()
})
