import type { DehydratedState } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { httpErrorFromResponse } from '@/service/http-error'
import { consoleQueryKey } from '@/test/console/operation-hooks'

const mocks = vi.hoisted(() => ({
  queryClient: undefined as QueryClient | undefined,
  profile: vi.fn(),
  workspace: vi.fn(),
  permissions: vi.fn(),
  features: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  headers: vi.fn(),
  resolveApiUrl: vi.fn(),
}))
vi.mock('@/app/get-query-client', () => ({ getQueryClient: () => mocks.queryClient }))
vi.mock('@/next/headers', () => ({ headers: () => mocks.headers() }))
vi.mock('@/next/navigation', () => ({ redirect: (url: string) => mocks.redirect(url) }))
vi.mock('@/features/account-profile/server', () => ({
  serverUserProfileQueryOptions: () => ({
    queryKey: consoleQueryKey('account.profile.get'),
    queryFn: mocks.profile,
    retry: false,
  }),
}))
vi.mock('@/service/console/server', () => ({
  resolveServerConsoleApiUrl: (...args: unknown[]) => mocks.resolveApiUrl(...args),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': mocks.features,
      'workspaces.current.summary.get': mocks.workspace,
      'workspaces.current.rbac.myPermissions.get': mocks.permissions,
    }),
  }
})

const clients: QueryClient[] = []
const createClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  return client
}
const keys = {
  features: consoleQuery.features.get.queryOptions().queryKey,
  workspace: consoleQuery.workspaces.current.summary.get.queryOptions().queryKey,
  permissions: consoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions().queryKey,
}
const stateOf = (element: ReactElement) =>
  (element as ReactElement<{ state: DehydratedState }>).props.state

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryClient = createClient()
  mocks.headers.mockResolvedValue(
    new Headers({ 'x-dify-pathname': '/apps', 'x-dify-search': '?tag=workflow' }),
  )
  mocks.resolveApiUrl.mockReturnValue('https://console.example.com/console/api/account/profile')
  mocks.profile.mockResolvedValue({
    profile: {
      id: 'account-id',
      name: 'Dify User',
      email: 'user@example.com',
      avatar: '',
      avatar_url: null,
      is_password_set: true,
    },
    meta: { currentVersion: '1.0.0', currentEnv: 'DEVELOPMENT' },
  })
  mocks.workspace.mockResolvedValue({
    id: 'workspace-id',
    name: 'Workspace',
    role: 'owner',
    plan: 'sandbox',
    credits: 200,
  })
  mocks.permissions.mockResolvedValue({
    workspace: { permission_keys: ['agent.acl.preview'] },
    app: { default_permission_keys: [], overrides: [] },
    dataset: { default_permission_keys: [], overrides: [] },
  })
  mocks.features.mockResolvedValue({ enable_skill: true })
})
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

it('hydrates the profile, workspace, permissions and feature data', async () => {
  const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
  const element = await CommonLayoutHydrationBoundary({ children: <div>Common shell</div> })
  const client = createClient()
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)

  expect(screen.getByText('Common shell')).toBeInTheDocument()
  expect(client.getQueryData(consoleQueryKey('account.profile.get'))).toMatchObject({
    profile: { id: 'account-id' },
  })
  expect(client.getQueryData(keys.workspace)).toMatchObject({ id: 'workspace-id' })
  expect(client.getQueryData(keys.permissions)).toMatchObject({
    workspace: { permission_keys: ['agent.acl.preview'] },
  })
  expect(client.getQueryData(keys.features)).toEqual({ enable_skill: true })
})

it.each([true, false])(
  'hydrates the initial skill flag as %s without fetching it again',
  async (enableSkill) => {
    mocks.features.mockResolvedValue({ enable_skill: enableSkill })
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
    function SkillFlag() {
      const { data } = useQuery(consoleQuery.features.get.queryOptions({ staleTime: Infinity }))
      return <output aria-label="Skills enabled">{String(data?.enable_skill)}</output>
    }
    const element = await CommonLayoutHydrationBoundary({ children: <SkillFlag /> })
    render(<QueryClientProvider client={createClient()}>{element}</QueryClientProvider>)
    expect(screen.getByLabelText('Skills enabled')).toHaveTextContent(String(enableSkill))
    expect(mocks.features).toHaveBeenCalledTimes(1)
  },
)

it('does not hydrate another request’s feature flag after a failed prefetch', async () => {
  const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
  await CommonLayoutHydrationBoundary({ children: null })
  expect(mocks.queryClient?.getQueryData(keys.features)).toEqual({ enable_skill: true })

  mocks.queryClient = createClient()
  mocks.features.mockRejectedValue(new Error('features unavailable'))
  const second = await CommonLayoutHydrationBoundary({ children: null })
  expect(stateOf(second).queries.map((query) => query.queryKey)).not.toContainEqual(keys.features)
  expect(mocks.redirect).not.toHaveBeenCalled()
})

it.each(['workspace', 'permissions', 'features'] as const)(
  'keeps the shell recoverable when %s fails',
  async (target) => {
    mocks[target].mockRejectedValue(new Error(`${target} unavailable`))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
    const element = await CommonLayoutHydrationBoundary({ children: <div>Common shell</div> })
    render(<QueryClientProvider client={createClient()}>{element}</QueryClientProvider>)

    expect(screen.getByText('Common shell')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(stateOf(element).queries.map((query) => query.queryKey)).not.toContainEqual(keys[target])
  },
)

it.each([
  {
    headers: { 'x-dify-pathname': '/apps', 'x-dify-search': '?tag=workflow' },
    destination: '/auth/refresh?redirect_url=%2Fapps%3Ftag%3Dworkflow',
  },
  { headers: new Headers(), destination: '/auth/refresh?redirect_url=%2F' },
])('redirects an unauthorized request to $destination', async ({ headers, destination }) => {
  mocks.headers.mockResolvedValue(new Headers(headers))
  mocks.profile.mockRejectedValue(
    await httpErrorFromResponse(
      new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }),
    ),
  )
  const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

  await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')
  expect(mocks.redirect).toHaveBeenCalledWith(destination)
})

it.each([
  ['not_setup', '/install'],
  ['not_init_validated', '/init'],
])('routes %s to the internal setup destination', async (code, destination) => {
  mocks.profile.mockRejectedValue(
    await httpErrorFromResponse(new Response(JSON.stringify({ code }), { status: 401 })),
  )
  const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
  await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')
  expect(mocks.redirect).toHaveBeenCalledWith(destination)
})

it('renders the shell without server prefetch when the API URL cannot be resolved', async () => {
  mocks.resolveApiUrl.mockReturnValue(null)
  const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')
  const element = await CommonLayoutHydrationBoundary({ children: <div>Common shell</div> })
  render(<QueryClientProvider client={createClient()}>{element}</QueryClientProvider>)
  expect(screen.getByText('Common shell')).toBeInTheDocument()
  for (const fetch of [mocks.profile, mocks.workspace, mocks.permissions, mocks.features])
    expect(fetch).not.toHaveBeenCalled()
})
