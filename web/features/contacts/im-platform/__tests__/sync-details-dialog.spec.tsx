import type { ImSyncResultItem } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { ContactImSyncDetailsDialog } from '../sync-details-dialog'
import { loadContactImSyncReport } from '../sync-report'
import { useContactImSyncResultUrlState, useContactImSyncRunUrlState } from '../sync-run-url-state'
import { defaultResponse, json, syncRun } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.mock('@/service/base', async () => {
  const { httpErrorFromResponse } = await import('@/service/http-error')
  return {
    request: async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const response = await network.handle(options.request)
      if (!response.ok) throw await httpErrorFromResponse(response)
      return response
    },
  }
})
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
const clients: QueryClient[] = []
const newClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return client
}
const contact = { id: 'contact-1', name: 'Alice', avatar_url: '', created_at: 1 }
const added = (index: number): ImSyncResultItem => ({
  id: `item-${index}`,
  result: {
    type: 'added',
    contact: { ...contact, id: `contact-${index}`, name: `Contact ${index}` },
    entry: { provider_user_id: `user-${index}`, display_name: `User ${index}` },
  },
})
beforeEach(() => {
  network.handle.mockImplementation(defaultResponse)
})
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

it('renders localized removal reasons with decorative avatars and the generated result type', async () => {
  network.handle.mockImplementation((request) =>
    request.url.includes('/latest/results')
      ? json({
          data: [
            {
              id: 'removed-1',
              result: {
                type: 'removed',
                contact,
                last_known_identity: {
                  identity_id: 'identity-1',
                  provider_user_id: 'alice',
                  display_name: 'Alice IM',
                },
                reason: 'binding_replaced',
              },
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        })
      : defaultResponse(request),
  )
  render(
    <QueryClientProvider client={newClient()}>
      <NuqsTestingAdapter searchParams="?sync_result=removed">
        <ContactImSyncDetailsDialog open runId="run-1" onOpenChange={() => {}} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  const table = await screen.findByRole('table', { name: 'contacts.imPlatform.details.title' })
  expect(
    await within(table).findByText('contacts.imPlatform.details.removalReason.binding_replaced'),
  ).toBeVisible()
  expect(within(table).queryByText('binding_replaced')).not.toBeInTheDocument()
  expect(within(table).queryByRole('img', { name: 'Alice' })).not.toBeInTheDocument()
  expect(
    screen.queryByText('contacts.imPlatform.details.filter.created_binding'),
  ).not.toBeInTheDocument()
})

it('retains a focused load-more action after the final page', async () => {
  network.handle.mockImplementation((request) => {
    if (request.url.includes('/latest/results')) {
      const page = Number(new URL(request.url).searchParams.get('page'))
      return json({ data: [added(page)], total: 21, page, limit: 20 })
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={newClient()}>
      <NuqsTestingAdapter>
        <ContactImSyncDetailsDialog open runId="run-1" onOpenChange={() => {}} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  const button = await screen.findByRole('button', { name: 'contacts.imPlatform.action.loadMore' })
  await user.click(button)
  expect(await screen.findByText('Contact 2')).toBeVisible()
  expect(button).toHaveFocus()
  expect(button).toHaveAttribute('aria-disabled', 'true')
})

it('exports pages of 100 without reloading latest before and after every page', async () => {
  network.handle.mockImplementation((request) => {
    if (request.url.endsWith('/latest'))
      return json({
        run: syncRun({
          result_counts: { added: 101, not_matched: 0, failed: 0, removed: 0, skipped: 0 },
        }),
      })
    if (request.url.includes('/latest/results')) {
      const params = new URL(request.url).searchParams
      const page = Number(params.get('page'))
      const result = params.get('result')
      expect(params.get('limit')).toBe('100')
      return json({
        data:
          result === 'added'
            ? page === 1
              ? Array.from({ length: 100 }, (_, index) => added(index))
              : [added(100)]
            : [],
        page,
        limit: 100,
        total: result === 'added' ? 101 : 0,
      })
    }
    return defaultResponse(request)
  })
  const result = await loadContactImSyncReport(newClient(), 'run-1')
  expect(result.items).toHaveLength(101)
  const requests = network.handle.mock.calls.map(([request]) => request)
  expect(requests.filter((request) => request.url.endsWith('/latest'))).toHaveLength(2)
  expect(requests.filter((request) => request.url.includes('/latest/results'))).toHaveLength(6)
})

it('refuses a report when a newer run replaced the requested one', async () => {
  network.handle.mockImplementation((request) =>
    request.url.endsWith('/latest')
      ? json({ run: syncRun({ id: 'run-2' }) })
      : defaultResponse(request),
  )
  await expect(loadContactImSyncReport(newClient(), 'run-1')).rejects.toMatchObject({
    code: 'sync_run_not_found',
  })
  expect(network.handle).toHaveBeenCalledTimes(1)
})

it('stores the actual run ID and result filter in URL state', async () => {
  const update = vi.fn()
  function Probe() {
    const [run, setRun] = useContactImSyncRunUrlState()
    const [result, setResult] = useContactImSyncResultUrlState()
    return (
      <>
        <output>
          {run}:{result}
        </output>
        <button onClick={() => setRun('run-42')}>Open run</button>
        <button onClick={() => setResult('removed')}>Removed</button>
      </>
    )
  }
  const user = userEvent.setup()
  render(
    <NuqsTestingAdapter hasMemory onUrlUpdate={update}>
      <Probe />
    </NuqsTestingAdapter>,
  )
  await user.click(screen.getByRole('button', { name: 'Open run' }))
  await user.click(screen.getByRole('button', { name: 'Removed' }))
  await waitFor(() =>
    expect(update.mock.lastCall?.[0].searchParams.get('sync_run_id')).toBe('run-42'),
  )
  await waitFor(() =>
    expect(update.mock.lastCall?.[0].searchParams.get('sync_result')).toBe('removed'),
  )
  expect(screen.getByText('run-42:removed')).toBeVisible()
})

it('refuses a report when pagination repeats a result instead of silently exporting duplicates', async () => {
  network.handle.mockImplementation((request) => {
    if (request.url.endsWith('/latest'))
      return json({
        run: syncRun({
          result_counts: { added: 2, not_matched: 0, failed: 0, removed: 0, skipped: 0 },
        }),
      })
    return json({ data: [added(1), added(1)], total: 2, page: 1, limit: 100 })
  })
  await expect(loadContactImSyncReport(newClient(), 'run-1')).rejects.toMatchObject({
    code: 'page_load_failed',
  })
})

it.each(['queued', 'running'] as const)(
  'waits for a %s run to finish before fetching final results',
  async (status) => {
    let finished = false
    network.handle.mockImplementation((request) => {
      if (request.url.endsWith('/latest')) return json({ run: syncRun({ status }) })
      if (request.url.includes('/latest/results'))
        return json({
          data: finished ? [added(1)] : [],
          total: finished ? 1 : 0,
          page: 1,
          limit: 20,
        })
      return defaultResponse(request)
    })
    const client = newClient()
    render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <ContactImSyncDetailsDialog open runId="run-1" onOpenChange={() => {}} />
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    )
    const latest = consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.get
    await waitFor(() =>
      expect(client.getQueryData(latest.queryKey())).toEqual({ run: syncRun({ status }) }),
    )
    expect(
      network.handle.mock.calls.filter(([request]) => request.url.includes('/latest/results')),
    ).toHaveLength(0)

    finished = true
    act(() => {
      client.setQueryData(latest.queryKey(), { run: syncRun({ status: 'succeeded' }) })
    })
    expect(await screen.findByText('Contact 1')).toBeVisible()
    expect(
      network.handle.mock.calls.filter(([request]) => request.url.includes('/latest/results')),
    ).toHaveLength(1)
  },
)
