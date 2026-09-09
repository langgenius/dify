import type { ImSyncRun } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsImPlatformProvider } from '../composition'
import { createContactImMockRepository } from '../mock/repository'
import { createContactImSyncApi } from '../repository'
import { ContactImSyncDetailsDialog } from '../sync-details-dialog'

type SyncClient = NonNullable<Parameters<typeof createContactImSyncApi>[1]>
type ImSyncResultItem = Awaited<
  ReturnType<SyncClient['imSyncRuns']['latest']['results']['get']>
>['data'][number]
const organization = {
  canManage: true,
  organizationId: 'org-details',
  workspaceId: 'workspace-details',
}
const createRun = (overrides: Partial<ImSyncRun> = {}): ImSyncRun => ({
  id: 'sync-latest',
  status: 'succeeded',
  provider: 'slack',
  channel_id: 'channel-slack',
  integration_config_version: 1,
  started_at: 1_700_000_000,
  finished_at: 1_700_000_030,
  error_message: null,
  result_counts: { added: 21, not_matched: 1, failed: 1, removed: 1, skipped: 1 },
  ...overrides,
})
const addedItem = (index: number): ImSyncResultItem => ({
  id: `added-${index}`,
  result: {
    type: 'added',
    contact: {
      id: `contact-${index}`,
      name: `Contact ${index}`,
      created_at: 1_700_000_000,
      avatar_url: '',
    },
    entry: {
      provider_user_id: `member-${index}`,
      display_name: `Member ${index}`,
      email: `member${index}@example.com`,
    },
  },
})
const renderDetails = ({
  run = createRun(),
  pageFailure = false,
  initialFailure = false,
}: { run?: ImSyncRun; pageFailure?: boolean; initialFailure?: boolean } = {}) => {
  const latest = vi.fn<SyncClient['imSyncRuns']['latest']['get']>().mockResolvedValue({ run })
  if (initialFailure) latest.mockRejectedValueOnce(new TypeError('Network unavailable'))
  let shouldFailPage = pageFailure
  const results = vi
    .fn<SyncClient['imSyncRuns']['latest']['results']['get']>()
    .mockImplementation(async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      if (page > 1 && shouldFailPage) {
        shouldFailPage = false
        throw new TypeError('Network unavailable')
      }
      const data: ImSyncResultItem[] =
        query.result === 'added'
          ? Array.from({ length: page === 1 ? 20 : 1 }, (_, index) =>
              addedItem((page - 1) * limit + index + 1),
            )
          : query.result === 'not_matched'
            ? [{ id: 'not-matched', result: { type: 'not_matched', entry: null } }]
            : query.result === 'failed'
              ? [
                  {
                    id: 'failed',
                    result: {
                      type: 'failed',
                      entry: { provider_user_id: 'failed-member', display_name: 'Failed member' },
                      reason: 'Directory access denied',
                    },
                  },
                ]
              : query.result === 'removed'
                ? [
                    {
                      id: 'removed',
                      result: {
                        type: 'removed',
                        contact: {
                          id: 'removed-contact',
                          name: 'Removed contact',
                          created_at: 1_700_000_000,
                          avatar_url: '',
                        },
                        last_known_identity: {
                          identity_id: 'removed-identity',
                          provider_user_id: 'removed-member',
                          display_name: 'Removed member',
                        },
                        reason: 'not_present_in_directory',
                      },
                    },
                  ]
                : [
                    {
                      id: 'skipped',
                      result: {
                        type: 'skipped',
                        contact: {
                          id: 'skipped-contact',
                          name: 'Skipped contact',
                          created_at: 1_700_000_000,
                          avatar_url: '',
                        },
                        entry: null,
                      },
                    },
                  ]
      return { data, page, limit, total: query.result === 'added' ? 21 : 1 }
    })
  const client: SyncClient = {
    imSyncRuns: {
      latest: { get: latest, results: { get: results } },
      post: vi.fn<SyncClient['imSyncRuns']['post']>().mockResolvedValue({ run }),
    },
  }
  const repository = Object.assign(
    createContactImMockRepository({ organization }),
    createContactImSyncApi(organization.workspaceId, client),
  )
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ContactsImPlatformProvider organization={organization} repository={repository}>
        {children}
      </ContactsImPlatformProvider>
    </QueryClientProvider>
  )
  return {
    latest,
    results,
    queryClient,
    ...render(<ContactImSyncDetailsDialog open runId="latest" onOpenChange={() => undefined} />, {
      wrapper,
    }),
  }
}

describe('Contact IM sync details dialog', () => {
  it('uses the five server result categories and never requests an all-results filter', async () => {
    const { results } = renderDetails()
    expect(await screen.findByText('Member 1')).toBeInTheDocument()
    for (const [result, count] of [
      ['added', 21],
      ['not_matched', 1],
      ['failed', 1],
      ['removed', 1],
      ['skipped', 1],
    ]) {
      expect(
        screen.getByRole('radio', {
          name: `contacts.imPlatform.details.filter.${result} ${count}`,
        }),
      ).toBeInTheDocument()
    }
    expect(screen.queryByRole('radio', { name: /filter.all/ })).not.toBeInTheDocument()
    expect(results).toHaveBeenCalledWith(
      { query: { result: 'added', page: 1, limit: 20 } },
      { context: { silent: true } },
    )
  })

  it('filters unmatched results with nullable entries and isolates results when switching categories', async () => {
    const user = userEvent.setup()
    const { results } = renderDetails()
    await user.click(
      await screen.findByRole('radio', {
        name: 'contacts.imPlatform.details.filter.not_matched 1',
      }),
    )
    await waitFor(() => expect(screen.queryByText('Member 1')).not.toBeInTheDocument())
    expect(screen.getAllByText('contacts.imPlatform.details.missing').length).toBeGreaterThan(0)
    expect(results).toHaveBeenCalledWith(
      { query: { result: 'not_matched', page: 1, limit: 20 } },
      { context: { silent: true } },
    )
    await user.click(
      screen.getByRole('radio', { name: 'contacts.imPlatform.details.filter.failed 1' }),
    )
    expect(await screen.findByText('Failed member')).toBeInTheDocument()
    expect(screen.getByText('Directory access denied')).toBeInTheDocument()
  })

  it('renders a removed binding from its last-known identity', async () => {
    const user = userEvent.setup()
    renderDetails()
    await user.click(
      await screen.findByRole('radio', { name: 'contacts.imPlatform.details.filter.removed 1' }),
    )
    expect(await screen.findByText('Removed contact')).toBeInTheDocument()
    expect(screen.getByText('Removed member')).toBeInTheDocument()
  })

  it('loads server page two without duplicating the first page', async () => {
    const user = userEvent.setup()
    const { results } = renderDetails()
    expect(await screen.findByText('Member 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }))
    expect(await screen.findByText('Member 21')).toBeInTheDocument()
    expect(screen.getAllByText('Member 1')).toHaveLength(1)
    expect(results).toHaveBeenLastCalledWith(
      { query: { result: 'added', page: 2, limit: 20 } },
      { context: { silent: true } },
    )
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.loadMore' }),
    ).not.toBeInTheDocument()
  })

  it('retains loaded results after a failed page and retries that page successfully', async () => {
    const user = userEvent.setup()
    renderDetails({ pageFailure: true })
    expect(await screen.findByText('Member 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }))
    expect(await screen.findByText('contacts.imPlatform.details.pageError')).toBeInTheDocument()
    expect(screen.getByText('Member 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' }))
    expect(await screen.findByText('Member 21')).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.details.pageError')).not.toBeInTheDocument()
  })

  it('recovers from an initial offline failure without requesting results before the run loads', async () => {
    const user = userEvent.setup()
    const { results } = renderDetails({ initialFailure: true })
    expect(await screen.findByText('contacts.imPlatform.details.loadError')).toBeInTheDocument()
    expect(results).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' }))
    expect(await screen.findByText('Member 1')).toBeInTheDocument()
  })

  it('shows the real server failure and handles runs that never started', async () => {
    renderDetails({
      run: createRun({
        status: 'failed',
        started_at: null,
        finished_at: null,
        error_message: 'Directory synchronization could not start',
      }),
    })
    expect(await screen.findByText('Directory synchronization could not start')).toBeInTheDocument()
    expect(screen.queryByText(/by null|Invalid Date/)).not.toBeInTheDocument()
  })
})
