import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery as renderWithoutUrlState } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import RosterPage from '../page'

const listAgents = vi.hoisted(() => vi.fn())
const queryValues = vi.hoisted(() => ({
  created_by_me: false,
  filter: 'all',
  keyword: '',
  sort_by: 'last_modified',
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'agent.get': listAgents }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('../components/agent-roster-list', () => ({
  AgentRosterList: () => <div>Agent roster</div>,
}))

const onUrlUpdate = vi.fn()
const render = (ui: ReactElement, options?: Parameters<typeof renderWithoutUrlState>[1]) =>
  renderWithoutUrlState(
    <NuqsTestingAdapter
      hasMemory
      onUrlUpdate={onUrlUpdate}
      searchParams={{ ...queryValues, created_by_me: String(queryValues.created_by_me) }}
    >
      {ui}
    </NuqsTestingAdapter>,
    options,
  )

describe('RosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryValues.created_by_me = false
    queryValues.filter = 'all'
    queryValues.keyword = ''
    queryValues.sort_by = 'last_modified'
    listAgents.mockReset().mockResolvedValue({
      data: [],
      has_more: false,
      page: 1,
      publication_counts: { drafts: 2, published: 1 },
    })
  })

  it('reconciles the route title with client branding', () => {
    render(<RosterPage />, {
      systemFeatures: {
        branding: {
          enabled: true,
          application_title: 'Acme',
        },
      },
    })

    expect(document.title).toBe('agentRoster.roster.title - Acme')
    expect(screen.getByRole('heading', { name: 'agentRoster.roster.title' })).toBeInTheDocument()
  })

  it('requests the publication filter and displays server-owned counts', async () => {
    queryValues.filter = 'drafts'
    render(<RosterPage />)
    expect(
      await screen.findByRole('radio', { name: 'agentRoster.roster.filters.published 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'agentRoster.roster.filters.drafts 2' }),
    ).toBeInTheDocument()
    expect(listAgents).toHaveBeenCalledWith({
      query: {
        limit: 30,
        page: 1,
        publication_status: 'drafts',
        sort_by: 'last_modified',
      },
    })
  })

  it('keeps previous counts while the next filter request is pending, then displays the new response', async () => {
    const user = userEvent.setup()
    const nextPage = createDeferred<unknown>()
    listAgents
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        page: 1,
        publication_counts: { drafts: 2, published: 1 },
      })
      .mockReturnValueOnce(nextPage.promise)
    render(<RosterPage />)
    expect(
      await screen.findByRole('radio', { name: 'agentRoster.roster.filters.published 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'agentRoster.roster.filters.drafts 2' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'agentRoster.roster.filters.drafts 2' }))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))
    expect(
      screen.getByRole('radio', { name: 'agentRoster.roster.filters.published 1' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'agentRoster.roster.filters.drafts 2' })).toBeChecked()
    await act(async () =>
      nextPage.resolve({
        data: [],
        has_more: false,
        page: 1,
        publication_counts: { drafts: 4, published: 1 },
      }),
    )
    expect(
      await screen.findByRole('radio', { name: 'agentRoster.roster.filters.drafts 4' }),
    ).toBeChecked()
  })

  it('renders stable zero counts before the first server response', () => {
    listAgents.mockReturnValue(new Promise(() => {}))

    render(<RosterPage />)

    expect(
      screen.getByRole('radio', { name: 'agentRoster.roster.filters.published 0' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'agentRoster.roster.filters.drafts 0' }),
    ).toBeInTheDocument()
  })
})
