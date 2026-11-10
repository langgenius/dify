import type { ConsumerConnectionProviderResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import ConnectionsPage from '../connections-page'

vi.mock('@/context/i18n', () => ({ useGetLanguage: () => 'en_US' }))

const provider: ConsumerConnectionProviderResponse = {
  provider: 'langgenius/firecrawl/firecrawl',
  label: { en_US: 'Firecrawl' },
  description: { en_US: 'Crawl websites' },
  icon: null,
  icon_dark: null,
  connections_count: 1,
}
const clients: ReturnType<typeof createTestQueryClient>[] = []

async function showConnections() {
  const client = createTestQueryClient()
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <ConnectionsPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

it('shows the shared loading indicator until the provider cards arrive', async () => {
  const response = createDeferred<Response>()
  vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise)
  const screen = await showConnections()
  const loading = screen.getByRole('progressbar', { name: 'common.loading' })
  await expect.element(loading).toBeVisible()
  await expect.element(screen.getByRole('link', { name: /Firecrawl/ })).not.toBeInTheDocument()

  response.resolve(Response.json({ data: [provider], has_more: false, next_cursor: null }))
  await expect.element(screen.getByRole('link', { name: /Firecrawl/ })).toBeVisible()
  await expect.element(loading).not.toBeInTheDocument()
})

it('removes loading after a list error without displaying the old error block, Retry or a false empty state', async () => {
  const response = createDeferred<Response>()
  vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise)
  const screen = await showConnections()
  const loading = screen.getByRole('progressbar', { name: 'common.loading' })
  await expect.element(loading).toBeVisible()

  response.resolve(
    Response.json(
      { code: 'internal_server_error', message: 'Provider list unavailable.', status: 500 },
      { status: 500 },
    ),
  )
  await expect.element(loading).not.toBeInTheDocument()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Provider list unavailable.')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.retry' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('heading', { name: 'app.endUser.noProviderConnections' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('heading', { name: 'app.endUser.myConnections' }))
    .toBeVisible()
})

it('preserves the empty state after a successful empty provider list', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ data: [], has_more: false, next_cursor: null }),
  )
  const screen = await showConnections()
  await expect
    .element(screen.getByRole('heading', { name: 'app.endUser.noProviderConnections' }))
    .toBeVisible()
  await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
})
