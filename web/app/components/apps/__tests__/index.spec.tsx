import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type {
  RecommendedAppDetailResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import { Apps } from '../index'

const { request, toast, checkDependencies, redirect, trackCreateApp, push, replace, search } =
  vi.hoisted(() => ({
    request: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    checkDependencies: vi.fn(),
    redirect: vi.fn(),
    trackCreateApp: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    search: { params: new URLSearchParams() },
  }))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast }))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({ handleCheckPluginDependencies: checkDependencies }),
}))
vi.mock('@/utils/app-redirection', () => ({ getRedirection: redirect }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({}),
  useSearchParams: () => search.params,
}))
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComponent = React.lazy(loader)
    return function Dynamic(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <LazyComponent {...props} />
        </React.Suspense>
      )
    }
  },
}))
vi.mock('@/app/education/expire-notice', () => ({ EducationExpireNotice: () => null }))
vi.mock('../list', async () => {
  const { default: LearnDify } = await import('@/app/components/explore/learn-dify')
  return {
    List: ({
      onCreateLearnDify,
      onTryLearnDify,
    }: {
      onCreateLearnDify: (app: RecommendedAppResponse) => void
      onTryLearnDify: (app: RecommendedAppResponse) => void
    }) => (
      <LearnDify
        canCreate
        onCreate={onCreateLearnDify}
        onTry={onTryLearnDify}
        dismissible={false}
      />
    ),
  }
})
// The running preview and marketplace download are separate feature boundaries.
vi.mock('../../explore/try-app', () => ({
  default: ({ onCreate, onClose }: { onCreate: () => void; onClose: () => void }) => (
    <section aria-label="Template preview">
      <button onClick={onCreate}>Create preview</button>
      <button onClick={onClose}>Close preview</button>
    </section>
  ),
}))
vi.mock('../import-from-marketplace-template-modal', () => ({
  default: ({
    templateId,
    onClose,
    onConfirm,
  }: {
    templateId: string
    onClose: () => void
    onConfirm: (dsl: string) => void
  }) => (
    <section aria-label="Marketplace download">
      <span>{templateId}</span>
      <button onClick={onClose}>Close download</button>
      <button onClick={() => onConfirm('marketplace-dsl')}>Import download</button>
    </section>
  ),
}))

const template: RecommendedAppResponse = {
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
}
const detail: RecommendedAppDetailResponse = {
  id: 'canonical-template',
  name: 'Sample App',
  mode: 'chat',
  can_trial: true,
  export_data: 'fresh-dsl',
}
const completed: Import = {
  id: 'import-1',
  status: 'completed',
  app_id: 'created-app',
  app_mode: 'chat',
  permission_keys: ['app.edit'],
}
let importResponse: Import
let detailFails: boolean
const clients = new Set<QueryClient>()
const features = zGetFeaturesResponse.parse({ apps: { size: 1, limit: 10 } })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  search.params = new URLSearchParams()
  importResponse = completed
  detailFails = false
  request.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname.replace('/console/api', '') + new URL(url).search
    if (path === '/explore/apps/canonical-template')
      return detailFails
        ? Response.json({ message: 'Unavailable' }, { status: 503 })
        : Response.json(detail)
    if (path === '/features') return Response.json(features)
    if (path === '/apps/imports') return Response.json(importResponse)
    if (path === '/apps/imports/import-1/confirm') return Response.json(completed)
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(async () => {
  cleanup()
  await Promise.all([...clients].map((client) => client.cancelQueries()))
  for (const client of clients) client.clear()
  clients.clear()
})

const setup = ({ cloud = false, permission = true, item = template } = {}) => {
  const queryClient = createConsoleQueryClient()
  clients.add(queryClient)
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
  return render(<Apps />, {
    queryClient,
    workspacePermissionKeys: permission ? ['app.create_and_management'] : [],
    systemFeatures: { deployment_edition: cloud ? 'CLOUD' : 'COMMUNITY', enable_learn_app: true },
    features: { apps: { size: 0, limit: 10 } },
  })
}
const openCreate = async (user: ReturnType<typeof userEvent.setup>, preview = false) => {
  await user.click(screen.getByRole('button', { name: 'Sample App' }))
  if (preview) await user.click(await screen.findByRole('button', { name: 'Create preview' }))
  return screen.findByRole('dialog')
}
const submit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
}

it('imports fresh canonical detail through the real form and import orchestration', async () => {
  const user = userEvent.setup()
  setup()
  await openCreate(user)
  expect(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder')).toHaveValue('')
  await submit(user)
  await waitFor(() => expect(redirect).toHaveBeenCalled())
  expect(
    request.mock.calls
      .map(([url]) => new URL(url).pathname.replace('/console/api', ''))
      .filter((path) => path !== '/features'),
  ).toEqual(['/explore/apps/canonical-template', '/apps/imports'])
  const importRequest = request.mock.calls.find(([url]) =>
    new URL(url).pathname.endsWith('/apps/imports'),
  )
  expect(await importRequest?.[2].request.json()).toMatchObject({
    yaml_content: 'fresh-dsl',
    name: 'Sample App',
    description: '',
  })
  expect(checkDependencies).toHaveBeenCalledWith('created-app')
  expect(toast.success).toHaveBeenCalledWith('app.newApp.appCreated')
})

it('tracks successful preview creation and closes the preview', async () => {
  const user = userEvent.setup()
  setup({ cloud: true })
  await openCreate(user, true)
  await submit(user)
  await waitFor(() =>
    expect(trackCreateApp).toHaveBeenCalledWith({
      source: 'studio_template_preview',
      templateId: 'canonical-template',
      appMode: 'chat',
    }),
  )
  expect(screen.queryByRole('region', { name: 'Template preview' })).not.toBeInTheDocument()
})

it('handles detail rejection once without import, navigation, or reopening the submitted modal', async () => {
  const user = userEvent.setup()
  detailFails = true
  setup()
  await openCreate(user)
  await submit(user)
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const paths = request.mock.calls.map(([url]) => new URL(url).pathname.replace('/console/api', ''))
  expect(paths.filter((path) => path === '/explore/apps/canonical-template')).toHaveLength(1)
  expect(paths.some((path) => path.startsWith('/apps/imports'))).toBe(false)
  expect(toast.error).toHaveBeenCalledOnce()
  expect(redirect).not.toHaveBeenCalled()
  expect(trackCreateApp).not.toHaveBeenCalled()
})

it('keeps the pending import confirmation and tracks only after successful confirmation', async () => {
  const user = userEvent.setup()
  importResponse = {
    id: 'import-1',
    status: 'pending',
    imported_dsl_version: '0.8.0',
    current_dsl_version: '0.6.0',
  }
  setup({ cloud: true })
  await openCreate(user, true)
  await submit(user)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('0.8.0')).toBeInTheDocument()
  expect(trackCreateApp).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'app.newApp.Confirm' }))
  await waitFor(() => expect(redirect).toHaveBeenCalled())
  expect(
    request.mock.calls
      .map(([url]) => new URL(url).pathname.replace('/console/api', ''))
      .filter((path) => path !== '/features'),
  ).toEqual(['/explore/apps/canonical-template', '/apps/imports', '/apps/imports/import-1/confirm'])
  expect(trackCreateApp).toHaveBeenCalledWith({
    source: 'studio_template_preview',
    templateId: 'canonical-template',
    appMode: 'chat',
  })
})

it('reports import failure without tracking or navigating', async () => {
  const user = userEvent.setup()
  importResponse = { id: 'import-1', status: 'failed' }
  setup({ cloud: true })
  await openCreate(user, true)
  await submit(user)
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed'))
  expect(redirect).not.toHaveBeenCalled()
  expect(trackCreateApp).not.toHaveBeenCalled()
})

it('keeps nullable template metadata editable through the actual modal', async () => {
  const user = userEvent.setup()
  setup({ item: { app_id: 'null-template', app: null, can_trial: false } })
  await user.click(screen.getByRole('button', { name: '' }))
  await screen.findByRole('dialog')
  expect(screen.getByPlaceholderText('app.newApp.appNamePlaceholder')).toHaveValue('')
  expect(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder')).toHaveValue('')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(request).not.toHaveBeenCalled()
})

it('does not allow template creation or marketplace import without permission', async () => {
  const user = userEvent.setup()
  search.params = new URLSearchParams('template-id=tpl-42')
  setup({ permission: false })
  await user.click(screen.getByRole('button', { name: 'Sample App' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Marketplace download' })).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})

it('preserves marketplace import tracking and removes only its URL parameter', async () => {
  const user = userEvent.setup()
  search.params = new URLSearchParams('template-id=tpl-42&category=chat')
  setup()
  await user.click(await screen.findByRole('button', { name: 'Import download' }))
  await waitFor(() =>
    expect(trackCreateApp).toHaveBeenCalledWith({
      source: 'external',
      templateId: 'tpl-42',
      appMode: 'chat',
    }),
  )
  expect(await request.mock.calls[0]![2].request.json()).toEqual({
    mode: 'yaml-content',
    yaml_content: 'marketplace-dsl',
  })
  expect(replace).toHaveBeenCalledWith('?category=chat', { scroll: false })
})
