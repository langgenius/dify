import type {
  ConsumerAppResponse,
  ConsumerAppsResponse,
  ConsumerConnectionProviderResponse,
  ConsumerConnectionProvidersResponse,
  ConsumerConnectionResponse,
  ConsumerConnectionsResponse,
} from '@dify/contracts/api/web/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createTestQueryClient } from '@/test/query-client'
import ConnectionsPage from '../connections-page'
import ProviderConnectionsPage from '../provider-connections-page'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))
const navigation = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => navigation }))
const locale = vi.hoisted(() => ({ language: 'en_US' }))
vi.mock('@/context/i18n', () => ({ useGetLanguage: () => locale.language }))

const provider = 'langgenius/google/drive'
const providerMetadata: ConsumerConnectionProviderResponse = {
  provider,
  label: { en_US: 'Google Drive', zh_Hans: '谷歌云端硬盘' },
  description: { en_US: 'Access your files', zh_Hans: '访问您的文件' },
  icon: 'https://example.com/google.svg',
  icon_dark: null,
  connections_count: 2,
}
const oauth: ConsumerConnectionResponse = {
  key: '11111111-1111-4111-8111-111111111111',
  provider,
  name: 'Work account',
  account_label: 'work@example.com',
  connection_type: 'oauth2',
  webapps_count: 3,
}
const apiKey: ConsumerConnectionResponse = {
  ...oauth,
  key: '22222222-2222-4222-8222-222222222222',
  name: 'Finance API key',
  account_label: null,
  connection_type: 'api-key',
  webapps_count: 1,
}
const linkedApp: ConsumerAppResponse = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Planning Assistant',
  description: 'Plan the next project milestone',
  mode: 'advanced-chat',
  icon_type: 'emoji',
  icon: '📅',
  icon_background: '#E0F2FE',
  app_code: 'planning-app',
  is_favorite: false,
  last_used_at: null,
}
const page = (
  data: ConsumerConnectionResponse[],
  next_cursor: string | null = null,
): ConsumerConnectionsResponse => ({ data, next_cursor, has_more: next_cursor !== null })
const providersPage = (
  data: ConsumerConnectionProviderResponse[],
  next_cursor: string | null = null,
): ConsumerConnectionProvidersResponse => ({ data, next_cursor, has_more: next_cursor !== null })
const appsPage = (
  data: ConsumerAppResponse[],
  next_cursor: string | null = null,
): ConsumerAppsResponse => ({ data, next_cursor, has_more: next_cursor !== null })
const queryClients: ReturnType<typeof createTestQueryClient>[] = []

function setup(content = <ProviderConnectionsPage providerId={provider} />) {
  const queryClient = createTestQueryClient()
  queryClients.push(queryClient)
  return renderWithConsoleQuery(content, {
    queryClient,
    accountProfile: null,
    currentWorkspace: null,
  })
}
function row(name: string) {
  return within(screen.getByRole('table')).getByRole('row', {
    name: new RegExp(name),
  })
}

beforeEach(() => {
  navigation.replace.mockReset()
  locale.language = 'en_US'
  window.history.replaceState({}, '', '/connections')
})
afterEach(() => {
  for (const client of queryClients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('My connections account API integration', () => {
  it('renders server-grouped providers and loads the next provider page', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(url)
      return Response.json(
        url.searchParams.has('cursor')
          ? providersPage([
              {
                ...providerMetadata,
                provider: 'langgenius/github/github',
                label: { en_US: 'GitHub' },
                description: { en_US: 'Access your repositories' },
                connections_count: 1,
              },
            ])
          : providersPage([providerMetadata], provider),
      )
    })
    setup(<ConnectionsPage />)

    const link = await screen.findByRole('link', { name: /Google Drive/ })
    expect(link).toHaveAttribute('href', `/connections/${encodeURIComponent(provider)}`)
    expect(within(link).getByText('Access your files')).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'common.operation.viewMore' }))
    expect(await screen.findByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      '/connections/langgenius%2Fgithub%2Fgithub',
    )
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(requests).toHaveLength(2)
    expect(requests[0]?.pathname).toBe('/api/me/connections')
    expect(requests[1]?.searchParams.get('cursor')).toBe(provider)
    expect(requests[0]?.searchParams.get('provider')).toBeNull()
  })

  it('localizes provider metadata and retains unavailable providers with an ID fallback', async () => {
    locale.language = 'zh_Hans'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        providersPage([
          providerMetadata,
          {
            ...providerMetadata,
            provider: 'uninstalled/provider',
            label: {},
            description: {},
            icon: null,
            icon_dark: null,
          },
          {
            ...providerMetadata,
            provider: 'english/provider',
            label: { en_US: 'English Provider' },
            description: { en_US: 'English description' },
          },
        ]),
      ),
    )
    setup(<ConnectionsPage />)
    expect(await screen.findByRole('link', { name: /谷歌云端硬盘/ })).toBeVisible()
    expect(screen.getByText('访问您的文件')).toBeVisible()
    expect(screen.getByRole('link', { name: /English Provider/ })).toBeVisible()
    expect(screen.getByText('English description')).toBeVisible()
    expect(screen.getByRole('link', { name: /uninstalled\/provider/ })).toHaveAttribute(
      'href',
      '/connections/uninstalled%2Fprovider',
    )
  })

  it('requests the provider detail endpoint, displays account labels and lazily paginates linked apps', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    let resolveFirstPage!: (response: Response) => void
    const firstPage = new Promise<Response>((resolve) => {
      resolveFirstPage = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/api/me/connections')
        return Response.json(providersPage([providerMetadata]))
      requests.push(url)
      if (url.pathname.endsWith('/apps')) {
        if (!url.searchParams.has('cursor')) return firstPage
        return Response.json(
          appsPage([
            {
              ...linkedApp,
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Budget helper',
              mode: 'workflow',
              app_code: 'budget-app',
            },
          ]),
        )
      }
      return Response.json(page([oauth, apiKey]))
    })
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Google Drive' })).toBeVisible()
    expect(await screen.findByRole('row', { name: /work@example.com/ })).toBeVisible()
    expect(screen.queryByText(oauth.name)).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(decodeURIComponent(requests[0]!.pathname)).toBe(
      `/api/me/connections/providers/${provider}/connections`,
    )
    expect(requests[0]?.searchParams.has('provider')).toBe(false)
    await user.click(
      within(row('work@example.com')).getByRole('button', {
        name: 'app.endUser.linkedAppCount:{"count":3}',
      }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'app.endUser.linkedAppsTitle:{"count":3}',
    })
    expect(within(dialog).getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
    await act(async () => resolveFirstPage(Response.json(appsPage([linkedApp], linkedApp.id))))
    const appLink = await within(dialog).findByRole('link', { name: linkedApp.name })
    expect(appLink).toHaveAttribute('href', '/chat/planning-app')
    expect(appLink).toHaveAttribute('target', '_blank')
    expect(appLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(dialog).getByText(linkedApp.description)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.viewMore' }))
    const nextAppLink = await within(dialog).findByRole('link', { name: 'Budget helper' })
    expect(nextAppLink).toHaveAttribute('href', '/workflow/budget-app')
    expect(nextAppLink).toHaveAttribute('target', '_blank')
    expect(nextAppLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(requests[1]?.pathname).toBe(`/api/me/connections/${oauth.key}/apps`)
    expect(requests[2]?.searchParams.get('cursor')).toBe(linkedApp.id)
  })

  it('cancels removal, retains errors for retry, then disconnects the correct connection group', async () => {
    const user = userEvent.setup()
    let connections = [oauth, apiKey]
    let rejectNext = true
    const removed: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const request = input as Request
      const url = new URL(request.url)
      if (url.pathname === '/api/me/connections')
        return Response.json(providersPage([providerMetadata]))
      if (request.method === 'DELETE') {
        removed.push(url.pathname)
        if (rejectNext) {
          rejectNext = false
          return Response.json(
            { code: 'connection_conflict', message: 'Connection is busy.', status: 409 },
            { status: 409 },
          )
        }
        connections = [oauth]
        return new Response(null, { status: 204 })
      }
      return Response.json(page(connections))
    })
    setup()
    await screen.findByRole('row', { name: /Finance API key/ })
    await user.click(
      within(row(apiKey.name)).getByRole('button', { name: 'app.endUser.deleteKey' }),
    )
    let dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(removed).toEqual([])
    await user.click(
      within(row(apiKey.name)).getByRole('button', { name: 'app.endUser.deleteKey' }),
    )
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'app.endUser.disconnect' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(
      within(screen.getByRole('table', { hidden: true })).getByText(apiKey.name),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'app.endUser.disconnect' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.queryByRole('row', { name: /Finance API key/ })).not.toBeInTheDocument()
    expect(row('work@example.com')).toBeVisible()
    expect(removed).toEqual([
      `/api/me/connections/${apiKey.key}`,
      `/api/me/connections/${apiKey.key}`,
    ])
  })

  it('shows a retryable list error instead of treating failure as an empty provider', async () => {
    const user = userEvent.setup()
    let rejectNext = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/api/me/connections')
        return Response.json(providersPage([providerMetadata]))
      if (rejectNext) {
        rejectNext = false
        return Response.json(
          { code: 'internal_server_error', message: 'Try again later.', status: 500 },
          { status: 500 },
        )
      }
      return Response.json(page([]))
    })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.queryByText('app.endUser.noProviderConnections')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/connections'))
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('app.endUser.noProviderConnections')
  })

  it('paginates the connections of one provider without losing the first page', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/api/me/connections')
        return Response.json(providersPage([providerMetadata]))
      requests.push(url)
      return Response.json(
        url.searchParams.has('cursor') ? page([apiKey]) : page([oauth], oauth.key),
      )
    })
    setup()
    await screen.findByRole('row', { name: /work@example.com/ })
    await user.click(screen.getByRole('button', { name: 'common.operation.viewMore' }))
    expect(await screen.findByRole('row', { name: /Finance API key/ })).toBeVisible()
    expect(row('work@example.com')).toBeVisible()
    expect(requests[1]?.searchParams.get('cursor')).toBe(oauth.key)
    expect(decodeURIComponent(requests[1]!.pathname)).toBe(
      `/api/me/connections/providers/${provider}/connections`,
    )
    expect(
      screen.queryByRole('button', { name: 'common.operation.viewMore' }),
    ).not.toBeInTheDocument()
  })

  it('does not reuse the previous account connection data after the auth session changes', async () => {
    let connections = [oauth]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/api/me/connections')
        return Response.json(
          providersPage([{ ...providerMetadata, label: { en_US: connections[0]!.name } }]),
        )
      return Response.json(page(connections))
    })
    setup()
    expect(await screen.findByRole('row', { name: /work@example.com/ })).toBeVisible()
    expect(await screen.findByRole('heading', { level: 1, name: oauth.name })).toBeVisible()
    connections = [apiKey]
    await act(async () => startWebAppAccountSession())
    expect(await screen.findByRole('row', { name: /Finance API key/ })).toBeVisible()
    expect(await screen.findByRole('heading', { level: 1, name: apiKey.name })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: oauth.name })).not.toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /work@example.com/ })).not.toBeInTheDocument()
  })

  it('finds localized provider metadata beyond the first page on direct detail navigation', async () => {
    locale.language = 'zh_Hans'
    window.history.replaceState({}, '', `/connections/${encodeURIComponent(provider)}`)
    const providerRequests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname !== '/api/me/connections') return Response.json(page([oauth]))
      providerRequests.push(url)
      return Response.json(
        url.searchParams.has('cursor')
          ? providersPage([providerMetadata])
          : providersPage(
              [
                {
                  ...providerMetadata,
                  provider: 'langgenius/github/github',
                  label: { en_US: 'GitHub' },
                },
              ],
              'next-provider',
            ),
      )
    })
    setup()

    expect(await screen.findByRole('heading', { level: 1, name: '谷歌云端硬盘' })).toBeVisible()
    expect(
      screen.getByText('app.endUser.providerConnectionsDescription:{"provider":"谷歌云端硬盘"}'),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: provider })).not.toBeInTheDocument()
    expect(providerRequests).toHaveLength(2)
    expect(providerRequests[1]?.searchParams.get('cursor')).toBe('next-provider')
  })

  it('waits for provider metadata before showing the detail header and connection table', async () => {
    locale.language = 'zh_Hans'
    let resolveMetadata!: (response: Response) => void
    const pendingMetadata = new Promise<Response>((resolve) => {
      resolveMetadata = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/api/me/connections') return pendingMetadata
      return Response.json(page([oauth]))
    })
    setup()

    expect(await screen.findByRole('progressbar', { name: 'common.loading' })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: provider })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await act(async () => resolveMetadata(Response.json(providersPage([providerMetadata]))))

    expect(await screen.findByRole('heading', { level: 1, name: '谷歌云端硬盘' })).toBeVisible()
    expect(await screen.findByRole('table', { name: '谷歌云端硬盘' })).toBeVisible()
    expect(row('work@example.com')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('falls back to the English provider label when the active locale has no translation', async () => {
    locale.language = 'zh_Hans'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      return Response.json(
        url.pathname === '/api/me/connections'
          ? providersPage([{ ...providerMetadata, label: { en_US: 'Google Drive' } }])
          : page([oauth]),
      )
    })
    setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Google Drive' })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: provider })).not.toBeInTheDocument()
  })

  it('retries provider metadata without losing the loaded connections', async () => {
    const user = userEvent.setup()
    let rejectMetadata = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname !== '/api/me/connections') return Response.json(page([oauth]))
      if (rejectMetadata) {
        rejectMetadata = false
        return Response.json(
          {
            code: 'internal_server_error',
            message: 'Provider information unavailable.',
            status: 500,
          },
          { status: 500 },
        )
      }
      return Response.json(providersPage([providerMetadata]))
    })
    setup()

    expect(await screen.findByRole('alert')).toHaveTextContent('Provider information unavailable.')
    expect(await screen.findByRole('row', { name: /work@example.com/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Google Drive' })).toBeVisible()
    expect(row('work@example.com')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
