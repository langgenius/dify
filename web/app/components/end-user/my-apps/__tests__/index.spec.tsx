import type { ConsumerAppResponse, ConsumerAppsResponse } from '@dify/contracts/api/web/types.gen'
import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createTestQueryClient } from '@/test/query-client'
import MyApps from '..'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const alpha: ConsumerAppResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha Assistant',
  description: 'Draft articles',
  mode: 'advanced-chat',
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#D5F5F6',
  app_code: 'alpha-app',
  is_favorite: false,
  last_used_at: 100,
}
const zebra: ConsumerAppResponse = {
  ...alpha,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Zebra Workflow',
  mode: 'workflow',
  app_code: 'zebra-app',
  is_favorite: true,
  last_used_at: 200,
}
const page = (
  data: ConsumerAppResponse[],
  next_cursor: string | null = null,
): ConsumerAppsResponse => ({
  data,
  next_cursor,
  has_more: next_cursor !== null,
})
const appLabel = (key: string, app: ConsumerAppResponse) =>
  `app.endUser.${key}:${JSON.stringify({ name: app.name })}`
const appNames = () => {
  const list = screen.queryByRole('list')
  return list
    ? within(list)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
    : []
}
const queryClients: ReturnType<typeof createTestQueryClient>[] = []

function setup(searchParams = '') {
  const queryClient = createTestQueryClient()
  queryClients.push(queryClient)
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const rendered = renderWithConsoleQuery(
    <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <MyApps />
    </NuqsTestingAdapter>,
    { queryClient, accountProfile: null, currentWorkspace: null },
  )
  return { ...rendered, onUrlUpdate }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/my-apps')
})
afterEach(() => {
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
  vi.restoreAllMocks()
})

describe('MyApps account API integration', () => {
  it('consumes all cursor pages before applying name sorting and opens actual Webapps', async () => {
    let finishSecondPage!: (response: Response) => void
    const secondPage = new Promise<Response>((resolve) => {
      finishSecondPage = resolve
    })
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(url)
      return url.searchParams.has('cursor') ? secondPage : Response.json(page([zebra], 'next-page'))
    })
    setup('?sort=name')
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByRole('link', { name: zebra.name })).not.toBeInTheDocument()
    await act(async () => {
      finishSecondPage(Response.json(page([alpha])))
    })

    expect(await screen.findByRole('link', { name: alpha.name })).toHaveAttribute(
      'href',
      '/chat/alpha-app',
    )
    expect(screen.getByRole('link', { name: zebra.name })).toHaveAttribute(
      'href',
      '/workflow/zebra-app',
    )
    expect(appNames()).toEqual([alpha.name, zebra.name])
    expect(requests[0]?.pathname).toMatch(/\/me\/apps$/)
    expect(requests[0]?.searchParams.get('view')).toBe('recent')
    expect(requests[1]?.searchParams.get('cursor')).toBe('next-page')
    expect(screen.getByRole('button', { name: appLabel('appActions', alpha) })).toBeVisible()
    expect(screen.queryByText('app.endUser.notConfigured')).not.toBeInTheDocument()
  })

  it('stops repeated cursors without displaying an error or a partial list', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(page([zebra], 'repeated')))
      .mockResolvedValueOnce(Response.json(page([alpha], 'repeated')))
    setup('?sort=name')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('link', { name: alpha.name })).not.toBeInTheDocument()
  })

  it('restores Starred, search and sorting from URL and delegates name search to the server', async () => {
    const requests: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requests.push(new URL(input instanceof Request ? input.url : String(input)))
      return Response.json(page([alpha, zebra].map((app) => ({ ...app, is_favorite: true }))))
    })
    setup('?view=starred&sort=name-desc&q=a')

    await screen.findByRole('link', { name: alpha.name })
    expect(requests[0]?.searchParams.get('view')).toBe('favorites')
    expect(requests[0]?.searchParams.get('name')).toBe('a')
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveValue('a')
    expect(appNames()).toEqual([zebra.name, alpha.name])
  })

  it('saves favorites before refreshing cards and blocks duplicate star submissions', async () => {
    const user = userEvent.setup()
    let finishFavorite!: (response: Response) => void
    const saving = new Promise<Response>((resolve) => {
      finishFavorite = resolve
    })
    let starred = false
    const changes: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'PUT') {
        changes.push(request)
        return saving
      }
      if (request.method === 'DELETE') {
        changes.push(request)
        starred = false
        return new Response(null, { status: 204 })
      }
      return Response.json(page([{ ...alpha, is_favorite: starred }]))
    })
    setup()
    const button = await screen.findByRole('button', { name: appLabel('starApp', alpha) })
    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.click(button)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.url).toMatch(new RegExp(`/me/apps/${alpha.id}/favorite$`))
    await act(async () => {
      starred = true
      finishFavorite(new Response(null, { status: 204 }))
    })
    expect(
      await screen.findByRole('button', { name: appLabel('unstarApp', alpha) }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: appLabel('unstarApp', alpha) }))
    expect(await screen.findByRole('button', { name: appLabel('starApp', alpha) })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(changes.map((request) => request.method)).toEqual(['PUT', 'DELETE'])
  })

  it('keeps favorite state unchanged after a failed save and permits retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      return request.method === 'PUT'
        ? Response.json(
            { code: 'invalid_param', message: 'Cannot save favorite.' },
            { status: 400 },
          )
        : Response.json(page([alpha]))
    })
    setup()
    await user.click(await screen.findByRole('button', { name: appLabel('starApp', alpha) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save favorite.')
    expect(screen.getByRole('button', { name: appLabel('starApp', alpha) })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('removes an app only after the request succeeds and prevents concurrent card actions', async () => {
    const user = userEvent.setup()
    let finishRemoval!: (response: Response) => void
    const removing = new Promise<Response>((resolve) => {
      finishRemoval = resolve
    })
    let removed = false
    const changes: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'DELETE') {
        changes.push(request)
        return removing
      }
      return Response.json(page(removed ? [zebra] : [alpha, zebra]))
    })
    setup()
    const actions = await screen.findByRole('button', { name: appLabel('appActions', alpha) })
    await user.click(actions)
    expect(
      screen.queryByRole('menuitem', { name: 'app.endUser.removeAndDeleteChats' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'app.endUser.removeFromList' }))

    await waitFor(() => expect(actions).toBeDisabled())
    const star = screen.getByRole('button', { name: appLabel('starApp', alpha) })
    expect(star).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('link', { name: alpha.name })).toBeVisible()
    await user.click(actions)
    await user.click(star)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.url).toMatch(new RegExp(`/me/apps/${alpha.id}$`))
    expect(changes[0]?.method).toBe('DELETE')
    expect(await changes[0]?.text()).toBe('')

    await act(async () => {
      removed = true
      finishRemoval(new Response(null, { status: 204 }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: alpha.name })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: zebra.name })).toBeVisible()
  })

  it('keeps a starred app after removal fails and allows retry without changing the filter', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const reads: URL[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'DELETE') {
        attempts += 1
        return attempts === 1
          ? Response.json(
              { code: 'invalid_param', message: 'Cannot remove this app.' },
              { status: 400 },
            )
          : new Response(null, { status: 204 })
      }
      reads.push(new URL(request.url))
      return Response.json(page(attempts < 2 ? [zebra] : []))
    })
    setup('?view=starred&q=Zebra&sort=name')
    await user.click(await screen.findByRole('button', { name: appLabel('appActions', zebra) }))
    await user.click(screen.getByRole('menuitem', { name: 'app.endUser.removeFromList' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot remove this app.')
    expect(screen.getByRole('link', { name: zebra.name })).toBeVisible()

    await user.click(screen.getByRole('button', { name: appLabel('appActions', zebra) }))
    await user.click(screen.getByRole('menuitem', { name: 'app.endUser.removeFromList' }))
    expect(await screen.findByRole('heading', { name: 'app.endUser.noResults' })).toBeVisible()
    expect(screen.queryByRole('link', { name: zebra.name })).not.toBeInTheDocument()
    expect(attempts).toBe(2)
    expect(reads).toHaveLength(2)
    expect(reads[1]?.searchParams.get('view')).toBe('favorites')
    expect(reads[1]?.searchParams.get('name')).toBe('Zebra')
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveValue('Zebra')
  })

  it('hides list errors without displaying a retry button or an empty library', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ code: 'unavailable', message: 'Unavailable.' }, { status: 503 }),
    )
    setup()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Unavailable.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'app.endUser.emptyApps' })).not.toBeInTheDocument()
  })

  it('distinguishes a filtered empty result and preserves view and sort when clearing search', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(page([])))
    const { onUrlUpdate } = setup('?view=starred&sort=name-desc&q=missing&unrelated=keep')
    expect(await screen.findByRole('heading', { name: 'app.endUser.noResults' })).toBeVisible()
    expect(screen.getByText('app.endUser.noResultsDescription')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(
      await screen.findByRole('heading', { name: 'app.endUser.emptyStarredApps' }),
    ).toBeVisible()
    expect(screen.getByText('app.endUser.emptyStarredAppsDescription')).toBeVisible()
    await waitFor(() => expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('q')).toBe(false))
    const params = onUrlUpdate.mock.lastCall?.[0].searchParams
    expect(params?.get('view')).toBe('starred')
    expect(params?.get('sort')).toBe('name-desc')
    expect(params?.get('unrelated')).toBe('keep')
    await user.click(screen.getByRole('radio', { name: 'app.endUser.all' }))
    expect(await screen.findByRole('heading', { name: 'app.endUser.emptyApps' })).toBeVisible()
    expect(screen.getByText('app.endUser.emptyAppsDescription')).toBeVisible()
  })

  it('drops previous account rows when the cookie account session changes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(page([alpha])))
      .mockResolvedValueOnce(Response.json(page([zebra])))
    setup()
    await screen.findByRole('link', { name: alpha.name })
    await act(async () => {
      startWebAppAccountSession()
    })
    expect(screen.queryByRole('link', { name: alpha.name })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: zebra.name })).toBeVisible()
  })
})
