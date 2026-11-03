import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as renderWithoutUrlState } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import RosterPage from '../page'

const listAgents = vi.hoisted(() => vi.fn())
const queryValues = vi.hoisted(() => ({
  agent_type: 'dify',
  created_by_me: false,
  external_status: 'all',
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
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({
  hasMemory: true,
  onUrlUpdate,
  searchParams: { ...queryValues, created_by_me: String(queryValues.created_by_me) },
}))

describe('RosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryValues.agent_type = 'dify'
    queryValues.created_by_me = false
    queryValues.external_status = 'all'
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

  it('opens the external tab directly without requesting the Dify agent list', () => {
    queryValues.agent_type = 'external'

    render(<RosterPage />)

    expect(screen.getByRole('tab', { name: 'agentRoster.roster.tabs.external' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()
    expect(listAgents).not.toHaveBeenCalled()
  })

  it('keeps Dify filters when switching tabs and isolates external status changes', async () => {
    const user = userEvent.setup()
    queryValues.created_by_me = true
    queryValues.filter = 'drafts'
    queryValues.keyword = 'Internal agent'
    queryValues.sort_by = 'earliest_created'
    render(<RosterPage />)

    const expectedRequest = {
      query: {
        limit: 30,
        page: 1,
        name: 'Internal agent',
        is_created_by_me: true,
        publication_status: 'drafts',
        sort_by: 'earliest_created',
      },
    }
    await waitFor(() => expect(listAgents).toHaveBeenCalledWith(expectedRequest))
    const callsBeforeExternal = listAgents.mock.calls.length

    await user.click(screen.getByRole('tab', { name: 'agentRoster.roster.tabs.external' }))
    await user.click(
      screen.getByRole('radio', { name: /agentRoster\.external\.filters\.disabled/ }),
    )

    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.get('agent_type')).toBe('external')
      expect(params?.get('external_status')).toBe('disabled')
      expect(params?.get('filter')).toBe('drafts')
      expect(params?.get('keyword')).toBe('Internal agent')
      expect(params?.get('sort_by')).toBe('earliest_created')
      expect(params?.get('created_by_me')).toBe('true')
    })
    expect(listAgents).toHaveBeenCalledTimes(callsBeforeExternal)

    await user.click(screen.getByRole('tab', { name: 'agentRoster.roster.tabs.dify' }))

    expect(
      screen.getByRole('radio', { name: /agentRoster\.roster\.filters\.drafts/ }),
    ).toBeChecked()
    expect(screen.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' })).toHaveValue(
      'Internal agent',
    )
    expect(
      screen.getByRole('checkbox', { name: 'agentRoster.roster.filters.createdByMe' }),
    ).toBeChecked()
    expect(
      screen.getByRole('combobox', { name: 'agentRoster.roster.sort.label' }),
    ).toHaveTextContent('agentRoster.roster.sort.earliestCreated')
    for (const [request] of listAgents.mock.calls) expect(request).toEqual(expectedRequest)
  })
})
