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

vi.mock('../components/roster-toolbar', async () => {
  const { useQueryState } = await import('nuqs')
  const { rosterFilterQueryParser } = await import('../query-params')
  return {
    RosterToolbar: ({
      publicationCounts,
    }: {
      publicationCounts: { drafts: number; published: number }
    }) => {
      const [filter, setFilter] = useQueryState('filter', rosterFilterQueryParser)
      return (
        <div>
          <span>{`Roster toolbar: ${publicationCounts.published} published, ${publicationCounts.drafts} drafts`}</span>
          <button
            type="button"
            aria-pressed={filter === 'drafts'}
            onClick={() => void setFilter('drafts')}
          >
            Drafts
          </button>
        </div>
      )
    },
  }
})

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

  it('uses the localized roster title for the page heading', () => {
    render(<RosterPage />)

    expect(screen.getByRole('heading', { name: 'agentRoster.roster.title' })).toHaveAttribute(
      'title',
      'agentRoster.roster.title',
    )
    expect(screen.getByRole('region', { name: 'agentRoster.roster.title' })).toBeInTheDocument()
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
  })

  it('requests the publication filter and displays server-owned counts', async () => {
    queryValues.filter = 'drafts'
    render(<RosterPage />)
    expect(await screen.findByText('Roster toolbar: 1 published, 2 drafts')).toBeInTheDocument()
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
    expect(await screen.findByText('Roster toolbar: 1 published, 2 drafts')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Drafts' }))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Roster toolbar: 1 published, 2 drafts')).toBeInTheDocument()
    await act(async () =>
      nextPage.resolve({
        data: [],
        has_more: false,
        page: 1,
        publication_counts: { drafts: 4, published: 1 },
      }),
    )
    expect(await screen.findByText('Roster toolbar: 1 published, 4 drafts')).toBeInTheDocument()
  })

  it('renders stable zero counts before the first server response', () => {
    listAgents.mockReturnValue(new Promise(() => {}))

    render(<RosterPage />)

    expect(screen.getByText('Roster toolbar: 0 published, 0 drafts')).toBeInTheDocument()
  })
})
