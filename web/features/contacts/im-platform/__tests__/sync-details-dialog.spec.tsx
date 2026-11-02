import type { ImSyncResultItem } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
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
vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn() }))
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
const renderDetails = (runId = 'run-1', searchParams = '') =>
  render(
    <QueryClientProvider client={newClient()}>
      <NuqsTestingAdapter hasMemory searchParams={searchParams}>
        <ContactImSyncDetailsDialog open runId={runId} onOpenChange={() => {}} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
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

it.each(['run', 'results'] as const)(
  'recovers an initial %s failure while preserving the selected result filter',
  async (failedRequest) => {
    let failed = false
    network.handle.mockImplementation((request) => {
      const url = new URL(request.url)
      const matchesRequest =
        failedRequest === 'run'
          ? url.pathname.endsWith('/latest')
          : url.pathname.endsWith('/latest/results')
      if (matchesRequest && !failed) {
        failed = true
        return json({ message: 'Temporarily unavailable' }, 503)
      }
      return defaultResponse(request)
    })
    const user = userEvent.setup()
    renderDetails('run-1', '?sync_result=failed')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'contacts.imPlatform.details.loadError',
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' }))

    expect(await screen.findByText('contacts.imPlatform.details.empty')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'contacts.imPlatform.details.filter.failed 0' }),
    ).toBeChecked()
    const resultRequests = network.handle.mock.calls
      .map(([request]) => new URL(request.url))
      .filter((url) => url.pathname.endsWith('/latest/results'))
    expect(resultRequests.length).toBeGreaterThan(0)
    expect(resultRequests.every((url) => url.searchParams.get('result') === 'failed')).toBe(true)
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }),
    ).toHaveAttribute('aria-disabled', 'true')
  },
)

it('keeps loaded contacts when the next page fails and retries that page without duplicates', async () => {
  let failedPage = false
  network.handle.mockImplementation((request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/latest/results')) {
      const page = Number(url.searchParams.get('page'))
      if (page === 2 && !failedPage) {
        failedPage = true
        return json({ message: 'Temporarily unavailable' }, 503)
      }
      return json({
        data: page === 1 ? Array.from({ length: 20 }, (_, index) => added(index + 1)) : [added(21)],
        total: 21,
        page,
        limit: 20,
      })
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderDetails()
  const table = await screen.findByRole('table', { name: 'contacts.imPlatform.details.title' })
  expect(within(table).getByText('Contact 20')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.details.pageError',
  )
  expect(within(table).getByText('Contact 1')).toBeVisible()
  expect(within(table).getAllByRole('row')).toHaveLength(21)
  await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' }))

  expect(await within(table).findByText('Contact 21')).toBeVisible()
  expect(within(table).getAllByRole('row')).toHaveLength(22)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }),
  ).toHaveAttribute('aria-disabled', 'true')
  const pages = network.handle.mock.calls
    .map(([request]) => new URL(request.url))
    .filter((url) => url.pathname.endsWith('/latest/results'))
  expect(pages.map((url) => url.searchParams.get('page'))).toEqual(['1', '2', '2'])
  expect(pages.every((url) => url.searchParams.get('limit') === '20')).toBe(true)
})

it('keeps contact matches separate from directory identities when switching result filters', async () => {
  const results: Record<string, ImSyncResultItem[]> = {
    added: [added(1)],
    not_matched: [
      {
        id: 'unmatched-email',
        result: {
          type: 'not_matched',
          entry: { provider_user_id: 'unmatched-user', email: 'unmatched@example.com' },
        },
      },
      { id: 'unmatched-no-identity', result: { type: 'not_matched', entry: null } },
    ],
    failed: [
      {
        id: 'failed-user',
        result: {
          type: 'failed',
          entry: { provider_user_id: 'suspended-user' },
          reason: 'Directory account suspended',
        },
      },
    ],
    skipped: [{ id: 'skipped-contact', result: { type: 'skipped', contact, entry: null } }],
  }
  network.handle.mockImplementation((request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/latest'))
      return json({
        run: syncRun({
          status: 'failed',
          error_message: 'Some directory entries could not be synchronized',
          result_counts: { added: 1, not_matched: 2, failed: 1, removed: 0, skipped: 1 },
        }),
      })
    if (url.pathname.endsWith('/latest/results')) {
      const rows = results[url.searchParams.get('result') ?? 'added'] ?? []
      return json({ data: rows, total: rows.length, page: 1, limit: 20 })
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderDetails()
  const table = await screen.findByRole('table', { name: 'contacts.imPlatform.details.title' })
  expect(within(table).getByText('Contact 1')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Some directory entries could not be synchronized',
  )

  await user.click(
    screen.getByRole('radio', { name: 'contacts.imPlatform.details.filter.not_matched 2' }),
  )
  const email = await screen.findByText('unmatched@example.com')
  const unmatchedRow = email.closest('tr')!
  const unmatchedTable = screen.getByRole('table', { name: 'contacts.imPlatform.details.title' })
  expect(within(unmatchedRow).getAllByRole('cell')[0]).toHaveTextContent(
    'contacts.imPlatform.details.missing',
  )
  expect(within(unmatchedTable).queryByText('Contact 1')).not.toBeInTheDocument()
  expect(within(unmatchedTable).queryByText('unmatched-user')).not.toBeInTheDocument()
  expect(within(unmatchedTable).getAllByRole('row')).toHaveLength(3)
  expect(within(unmatchedTable).getAllByText('contacts.imPlatform.details.missing')).toHaveLength(3)

  await user.click(
    screen.getByRole('radio', { name: 'contacts.imPlatform.details.filter.failed 1' }),
  )
  expect(await screen.findByText('suspended-user')).toBeVisible()
  const failedTable = screen.getByRole('table', { name: 'contacts.imPlatform.details.title' })
  expect(within(failedTable).getByText('Directory account suspended')).toBeVisible()
  expect(within(failedTable).queryByText('unmatched@example.com')).not.toBeInTheDocument()

  await user.click(
    screen.getByRole('radio', { name: 'contacts.imPlatform.details.filter.skipped 1' }),
  )
  const skippedRow = (await screen.findByText('Alice')).closest('tr')!
  expect(within(skippedRow).getAllByRole('cell')[1]).toHaveTextContent(
    'contacts.imPlatform.details.missing',
  )
  expect(screen.queryByText('suspended-user')).not.toBeInTheDocument()
})

it('does not show another run’s results under the requested run identity', async () => {
  network.handle.mockImplementation((request) =>
    request.url.endsWith('/latest')
      ? json({ run: syncRun({ id: 'run-2' }) })
      : defaultResponse(request),
  )
  renderDetails('run-1')

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.details.reportChanged',
  )
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(
    network.handle.mock.calls.some(([request]) => request.url.includes('/latest/results')),
  ).toBe(false)
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

it('downloads the selected latest report with contact and platform columns kept distinct and formulae escaped', async () => {
  const rows: Record<string, ImSyncResultItem[]> = {
    added: [
      {
        id: 'added-formula',
        result: {
          type: 'added',
          contact: { ...contact, name: '=Alice' },
          entry: {
            provider_user_id: 'alice-im',
            display_name: '+Directory Alice',
            email: 'alice@directory.example',
          },
        },
      },
    ],
    not_matched: [{ id: 'unmatched', result: { type: 'not_matched', entry: null } }],
    failed: [{ id: 'failed', result: { type: 'failed', reason: 'Directory unavailable' } }],
    removed: [
      {
        id: 'removed',
        result: {
          type: 'removed',
          contact,
          last_known_identity: { identity_id: 'old-id', provider_user_id: 'old-alice' },
          reason: 'binding_invalidated',
        },
      },
    ],
    skipped: [{ id: 'skipped', result: { type: 'skipped', contact, entry: null } }],
  }
  network.handle.mockImplementation((request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/latest'))
      return json({
        run: syncRun({
          result_counts: { added: 1, not_matched: 1, failed: 1, removed: 1, skipped: 1 },
        }),
      })
    if (url.pathname.endsWith('/latest/results')) {
      const result = url.searchParams.get('result') ?? 'added'
      return json({
        data: rows[result],
        total: 1,
        page: Number(url.searchParams.get('page')),
        limit: Number(url.searchParams.get('limit')),
      })
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderDetails('latest')
  await user.click(
    await screen.findByRole('button', { name: 'contacts.imPlatform.details.downloadReport' }),
  )

  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
  const { data, fileName } = vi.mocked(downloadBlob).mock.calls[0]![0]
  expect(fileName).toBe('im-sync-run-1.csv')
  expect(data.type).toBe('text/csv;charset=utf-8;')
  const csv = await data.text()
  expect(csv).toContain(
    '\uFEFFrun_id,result,contact_id,contact_name,provider,platform_user_id,platform_display_name,platform_email,reason',
  )
  expect(csv).toContain("'=Alice")
  expect(csv).toContain("'+Directory Alice")
  expect(csv).toContain('feishu,alice-im,')
  expect(csv).toContain('alice@directory.example')
  expect(csv).toContain('run-1,contacts.imPlatform.details.filter.not_matched,,,feishu,,,,')
  expect(csv).toContain(
    'run-1,contacts.imPlatform.details.filter.failed,,,feishu,,,,Directory unavailable',
  )
  expect(csv).toContain('old-alice,,,contacts.imPlatform.details.removalReason.binding_invalidated')
  expect(csv).toContain(
    'run-1,contacts.imPlatform.details.filter.skipped,contact-1,Alice,feishu,,,,',
  )
})

it('keeps an empty report available after a failed download and allows retrying', async () => {
  let failed = false
  network.handle.mockImplementation((request) => {
    const url = new URL(request.url)
    if (
      url.pathname.endsWith('/latest/results') &&
      url.searchParams.get('limit') === '100' &&
      !failed
    ) {
      failed = true
      return json({ message: 'Report temporarily unavailable' }, 503)
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderDetails()
  const download = await screen.findByRole('button', {
    name: 'contacts.imPlatform.details.downloadReport',
  })
  expect(screen.getByText('contacts.imPlatform.details.empty')).toBeVisible()
  await user.click(download)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.details.downloadFailed',
  )
  expect(downloadBlob).not.toHaveBeenCalled()
  expect(screen.getByText('contacts.imPlatform.details.empty')).toBeVisible()
  await user.click(download)

  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('refuses to download when latest is replaced after the dialog opened', async () => {
  let latestRequests = 0
  network.handle.mockImplementation((request) => {
    if (request.url.endsWith('/latest')) {
      latestRequests += 1
      return json({ run: syncRun({ id: latestRequests === 1 ? 'run-1' : 'run-2' }) })
    }
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderDetails('latest')
  await user.click(
    await screen.findByRole('button', { name: 'contacts.imPlatform.details.downloadReport' }),
  )

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.details.reportChanged',
  )
  expect(downloadBlob).not.toHaveBeenCalled()
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

it('stores the actual run ID and result filter in URL state without adding history entries', async () => {
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
  expect(update.mock.calls.map(([event]) => event.options.history)).not.toContain('push')
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
