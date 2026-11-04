import type {
  ConsumerAppResponse,
  ConsumerAppsResponse,
  ConsumerConnectionResponse,
  ConsumerConnectionsResponse,
} from '@dify/contracts/api/web/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createTestQueryClient } from '@/test/query-client'
import ConnectionsPage from '../connections-page'
import ProviderConnectionsPage from '../provider-connections-page'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const provider = 'langgenius/google/drive'
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
  return within(screen.getByRole('table', { name: provider })).getByRole('row', {
    name: new RegExp(name),
  })
}

beforeEach(() => {
  window.history.replaceState({}, '', '/connections')
})
afterEach(() => {
  for (const client of queryClients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('My connections account API integration', () => {
  it('retains every connection with the same provider within and across cursor pages', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(url)
      return Response.json(
        url.searchParams.has('cursor')
          ? page([
              { ...apiKey, key: '44444444-4444-4444-8444-444444444444' },
              {
                ...apiKey,
                key: '55555555-5555-4555-8555-555555555555',
                provider: 'langgenius/github/github',
              },
            ])
          : page([oauth, apiKey], 'next-connection'),
      )
    })
    setup(<ConnectionsPage />)

    const initialLinks = await screen.findAllByRole('link', { name: provider })
    expect(initialLinks).toHaveLength(2)
    for (const link of initialLinks)
      expect(link).toHaveAttribute('href', `/connections/${encodeURIComponent(provider)}`)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'common.operation.viewMore' }))
    expect(await screen.findByRole('link', { name: 'langgenius/github/github' })).toHaveAttribute(
      'href',
      '/connections/langgenius%2Fgithub%2Fgithub',
    )
    expect(screen.getAllByRole('link', { name: provider })).toHaveLength(3)
    expect(screen.getAllByRole('link')).toHaveLength(4)
    for (const link of screen.getAllByRole('link', { name: provider }))
      expect(link).toHaveAttribute('href', `/connections/${encodeURIComponent(provider)}`)
    expect(requests).toHaveLength(2)
    expect(requests[0]?.pathname).toBe('/api/me/connections')
    expect(requests[1]?.searchParams.get('cursor')).toBe('next-connection')
    expect(requests[0]?.searchParams.get('provider')).toBeNull()
  })

  it('filters by the full provider ID, displays account labels and lazily paginates linked apps', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(url)
      if (url.pathname.endsWith('/apps')) {
        return Response.json(
          url.searchParams.has('cursor')
            ? appsPage([
                {
                  ...linkedApp,
                  id: '44444444-4444-4444-8444-444444444444',
                  name: 'Budget helper',
                  mode: 'workflow',
                  app_code: 'budget-app',
                },
              ])
            : appsPage([linkedApp], linkedApp.id),
        )
      }
      return Response.json(page([oauth, apiKey]))
    })
    setup()
    expect(await screen.findByRole('row', { name: /work@example.com/ })).toBeVisible()
    expect(screen.queryByText(oauth.name)).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.get('provider')).toBe(provider)
    await user.click(
      within(row('work@example.com')).getByRole('button', {
        name: 'app.endUser.linkedAppCount:{"count":3}',
      }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'app.endUser.linkedAppsTitle:{"count":3}',
    })
    expect(await within(dialog).findByRole('link', { name: linkedApp.name })).toHaveAttribute(
      'href',
      '/chat/planning-app',
    )
    expect(within(dialog).getByText(linkedApp.description)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.viewMore' }))
    expect(await within(dialog).findByRole('link', { name: 'Budget helper' })).toHaveAttribute(
      'href',
      '/workflow/budget-app',
    )
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
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(
          { code: 'internal_server_error', message: 'Try again later.', status: 500 },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(Response.json(page([])))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.queryByText('app.endUser.noProviderConnections')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByRole('heading', { name: 'app.endUser.noProviderConnections' }),
    ).toBeVisible()
  })

  it('does not reuse the previous account connection data after the auth session changes', async () => {
    let connections = [oauth]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(page(connections)))
    setup()
    expect(await screen.findByRole('row', { name: /work@example.com/ })).toBeVisible()
    connections = [apiKey]
    await act(async () => startWebAppAccountSession())
    expect(await screen.findByRole('row', { name: /Finance API key/ })).toBeVisible()
    expect(screen.queryByRole('row', { name: /work@example.com/ })).not.toBeInTheDocument()
  })
})
