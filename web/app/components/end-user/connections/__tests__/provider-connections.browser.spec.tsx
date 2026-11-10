import type {
  ConsumerConnectionProviderResponse,
  ConsumerConnectionResponse,
} from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import ProviderConnectionsPage from '../provider-connections-page'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  list: vi.fn<() => Response | Promise<Response>>(),
  providers: vi.fn<() => Response | Promise<Response>>(),
  remove: vi.fn<() => Response | Promise<Response>>(),
}))
vi.mock('@/next/navigation', () => {
  const router = { replace: mocks.replace }
  return { useRouter: () => router }
})
vi.mock('@/context/i18n', () => ({ useGetLanguage: () => 'en_US' }))
vi.mock('@/app/notifications', () => ({
  toast: { info: mocks.info, success: mocks.success, error: vi.fn() },
}))

const providerId = 'langgenius/firecrawl/firecrawl'
const providerIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="orange"/></svg>')}`
const provider: ConsumerConnectionProviderResponse = {
  provider: providerId,
  label: { en_US: 'Firecrawl' },
  description: { en_US: 'Crawl websites' },
  icon: providerIcon,
  icon_dark: null,
  connections_count: 1,
}
const connection: ConsumerConnectionResponse = {
  key: '11111111-1111-4111-8111-111111111111',
  provider: providerId,
  name: 'Personal API Key',
  account_label: null,
  connection_type: 'api-key',
  webapps_count: 0,
}
const clients: ReturnType<typeof createTestQueryClient>[] = []
let hasConnections: boolean

function connectionPage(data: ConsumerConnectionResponse[]) {
  return Response.json({ data, has_more: false, next_cursor: null })
}

beforeEach(() => {
  hasConnections = true
  mocks.list
    .mockReset()
    .mockImplementation(() => connectionPage(hasConnections ? [connection] : []))
  mocks.providers.mockReset().mockImplementation(() =>
    Response.json({
      data: hasConnections ? [provider] : [],
      has_more: false,
      next_cursor: null,
    }),
  )
  mocks.remove.mockReset().mockImplementation(() => {
    hasConnections = false
    return new Response(null, { status: 204 })
  })
  window.history.replaceState({}, '', `/connections/${encodeURIComponent(providerId)}`)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (request.method === 'DELETE' && path === `/api/me/connections/${connection.key}`)
      return mocks.remove()
    if (path === '/api/me/connections') return mocks.providers()
    if (decodeURIComponent(path) === `/api/me/connections/providers/${providerId}/connections`)
      return mocks.list()
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

function showProvider() {
  const client = createTestQueryClient()
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <ProviderConnectionsPage providerId={providerId} />
    </QueryClientProvider>,
  )
}

it('waits for invalidated queries before reporting a successful final disconnection and redirecting', async () => {
  const screen = await showProvider()
  await expect.element(screen.getByRole('heading', { level: 1, name: 'Firecrawl' })).toBeVisible()
  const refresh = createDeferred<Response>()
  mocks.providers.mockReturnValueOnce(refresh.promise)
  await screen.getByRole('button', { name: 'app.endUser.deleteKey' }).click()
  await screen
    .getByRole('alertdialog')
    .getByRole('button', { name: 'app.endUser.disconnect' })
    .click()

  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await expect.poll(() => mocks.providers.mock.calls.length).toBe(2)
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.success).not.toHaveBeenCalled()
  expect(mocks.info).not.toHaveBeenCalled()

  refresh.resolve(Response.json({ data: [], has_more: false, next_cursor: null }))
  await expect.poll(() => mocks.replace.mock.calls).toEqual([['/connections']])
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith('common.api.actionSuccess')
  expect(mocks.info).not.toHaveBeenCalled()
  await expect
    .element(screen.getByRole('heading', { level: 1, name: providerId }))
    .not.toBeInTheDocument()
})

it('redirects a direct visit to an empty provider without showing its ID as a header', async () => {
  hasConnections = false
  const screen = await showProvider()

  await expect.poll(() => mocks.replace.mock.calls).toEqual([['/connections']])
  expect(mocks.info).toHaveBeenCalledExactlyOnceWith('app.endUser.noProviderConnections')
  expect(mocks.success).not.toHaveBeenCalled()
  await expect
    .element(screen.getByRole('heading', { level: 1, name: providerId }))
    .not.toBeInTheDocument()
})

it('keeps the connection after a failed disconnection without success feedback or navigation', async () => {
  mocks.remove.mockReturnValueOnce(
    Response.json(
      { code: 'connection_conflict', message: 'Connection is busy.', status: 409 },
      { status: 409 },
    ),
  )
  const screen = await showProvider()
  await screen.getByRole('button', { name: 'app.endUser.deleteKey' }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'app.endUser.disconnect' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  expect(mocks.success).not.toHaveBeenCalled()
  expect(mocks.info).not.toHaveBeenCalled()
  expect(mocks.replace).not.toHaveBeenCalled()

  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('row', { name: /Personal API Key/ })).toBeVisible()
})

it('does not treat a pending connection list as an empty provider', async () => {
  const response = createDeferred<Response>()
  mocks.list.mockReturnValueOnce(response.promise)
  const screen = await showProvider()

  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await expect.poll(() => mocks.list.mock.calls.length).toBe(1)
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.info).not.toHaveBeenCalled()

  response.resolve(connectionPage([connection]))
  await expect.element(screen.getByRole('row', { name: /Personal API Key/ })).toBeVisible()
  expect(mocks.replace).not.toHaveBeenCalled()
})

it('keeps a failed list on the page for retry instead of redirecting it as empty', async () => {
  mocks.list.mockResolvedValueOnce(
    Response.json(
      { code: 'internal_server_error', message: 'Try again later.', status: 500 },
      { status: 500 },
    ),
  )
  const screen = await showProvider()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('Try again later.')
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.info).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(screen.getByRole('row', { name: /Personal API Key/ })).toBeVisible()
  expect(mocks.replace).not.toHaveBeenCalled()
})
