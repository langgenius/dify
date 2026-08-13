import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import RosterPage from '../page'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: (name: string) => {
      if (name === 'keyword') return ['', vi.fn()]
      if (name === 'filter') return ['all', vi.fn()]
      if (name === 'created_by_me') return [false, vi.fn()]
      return ['updated_at', vi.fn()]
    },
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: () => ({
      data: { pages: [{ data: [], has_more: false, page: 1 }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPending: false,
    }),
  }
})

vi.mock('../components/agent-roster-list', () => ({
  AgentRosterList: () => <div>Agent roster</div>,
}))

vi.mock('../components/roster-toolbar', () => ({
  RosterToolbar: () => <div>Roster toolbar</div>,
}))

describe('RosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the localized roster title for the page heading', () => {
    render(<RosterPage />)

    expect(screen.getByRole('heading', { name: 'agentV2.roster.title' })).toBeInTheDocument()
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

    expect(document.title).toBe('agentV2.roster.title - Acme')
  })
})
