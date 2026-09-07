import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import RosterPage from '../page'

const infiniteOptions = vi.hoisted(() => vi.fn((options) => options))
const useInfiniteQueryOptions = vi.hoisted(() => vi.fn())
const queryValues = vi.hoisted(() => ({
  created_by_me: false,
  filter: 'all',
  keyword: '',
  sort_by: 'last_modified',
}))
const rosterQueryState = vi.hoisted(() => ({
  data: {
    pages: [
      {
        data: [],
        has_more: false,
        page: 1,
        publication_counts: { drafts: 2, published: 1 },
      },
    ],
  } as
    | {
        pages: Array<{
          data: never[]
          has_more: boolean
          page: number
          publication_counts: { drafts: number; published: number }
        }>
      }
    | undefined,
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const agentQuery = actual.consoleQuery.agent
  const agentQueryWithInputCapture = new Proxy(agentQuery, {
    get(target, property, receiver) {
      if (property !== 'get') return Reflect.get(target, property, receiver)

      return {
        ...agentQuery.get,
        infiniteOptions,
      }
    },
  })

  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, property, receiver) {
        if (property === 'agent') return agentQueryWithInputCapture

        return Reflect.get(target, property, receiver)
      },
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: (name: keyof typeof queryValues) => [queryValues[name], vi.fn()],
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: (options: unknown) => {
      useInfiniteQueryOptions(options)
      return {
        data: rosterQueryState.data,
        error: null,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchNextPageError: false,
        isFetching: false,
        isFetchingNextPage: false,
        isLoadingError: false,
        isPending: false,
        isRefetchError: false,
        refetch: vi.fn(),
      }
    },
  }
})

vi.mock('../components/agent-roster-list', () => ({
  AgentRosterList: () => <div>Agent roster</div>,
}))

vi.mock('../components/roster-toolbar', () => ({
  RosterToolbar: ({
    publicationCounts,
  }: {
    publicationCounts: { drafts: number; published: number }
  }) => (
    <div>{`Roster toolbar: ${publicationCounts.published} published, ${publicationCounts.drafts} drafts`}</div>
  ),
}))

describe('RosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryValues.created_by_me = false
    queryValues.filter = 'all'
    queryValues.keyword = ''
    queryValues.sort_by = 'last_modified'
    rosterQueryState.data = {
      pages: [
        {
          data: [],
          has_more: false,
          page: 1,
          publication_counts: { drafts: 2, published: 1 },
        },
      ],
    }
  })

  it('uses the localized roster title for the page heading', () => {
    render(<RosterPage />)

    expect(screen.getByRole('heading', { name: 'agentV2.roster.title' })).toHaveAttribute(
      'title',
      'agentV2.roster.title',
    )
    expect(screen.getByRole('region', { name: 'agentV2.roster.title' })).toBeInTheDocument()
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

  it('uses the generated publication filter and server-owned counts', () => {
    queryValues.filter = 'drafts'

    render(<RosterPage />)

    const options = infiniteOptions.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options || typeof options.input !== 'function')
      throw new Error('Expected paginated query input')

    expect(options.input(1)).toEqual({
      query: {
        limit: 30,
        page: 1,
        publication_status: 'drafts',
        sort_by: 'last_modified',
      },
    })
    expect(screen.getByText('Roster toolbar: 1 published, 2 drafts')).toBeInTheDocument()
  })

  it('configures the roster query to keep previous filter data', () => {
    render(<RosterPage />)

    const options = useInfiniteQueryOptions.mock.lastCall?.[0] as {
      placeholderData?: (previousData: object) => object | undefined
    }
    const previousData = { pages: [{ data: ['previous agent'] }] }

    expect(options.placeholderData?.(previousData)).toBe(previousData)
  })

  it('renders stable zero counts before the first server response', () => {
    rosterQueryState.data = undefined

    render(<RosterPage />)

    expect(screen.getByText('Roster toolbar: 0 published, 0 drafts')).toBeInTheDocument()
  })
})
