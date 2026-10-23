import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import KnowledgeGraph from '../index'

type QueryState = {
  data?: unknown
  isLoading?: boolean
  isError?: boolean
  error?: unknown
}

type StatsPollOptions = {
  refetchInterval: (query: { state: { data?: { building?: boolean } } }) => number | false
}

const queries: Record<'stats' | 'graph', QueryState> = { stats: {}, graph: {} }
const queryOptions: Partial<Record<'stats' | 'graph', unknown>> = {}
const mockRetry = vi.fn()
const mockRefetch = vi.fn()
const mockPush = vi.fn()
let mockGraphEnabled = true

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey: ['stats' | 'graph'] }) => {
      queryOptions[options.queryKey[0]] = options
      return {
        isLoading: false,
        isError: false,
        ...queries[options.queryKey[0]],
        refetch: mockRefetch,
      }
    },
    useMutation: (options: { onSuccess?: () => void }) => ({
      mutate: (variables: unknown) => {
        mockRetry(variables)
        options.onSuccess?.()
      },
      isPending: false,
    }),
  }
})

vi.mock('@/service/console', () => ({
  consoleQuery: {
    datasets: {
      byDatasetId: {
        graph: {
          get: { queryOptions: () => ({ queryKey: ['graph'] }) },
          stats: { get: { queryOptions: () => ({ queryKey: ['stats'] }) } },
          retry: { post: { mutationOptions: () => ({}) } },
        },
      },
    },
  },
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: unknown) => unknown) =>
    selector({ dataset: { graph_index_setting: { enabled: mockGraphEnabled } } }),
}))

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

vi.mock('../graph-view', () => ({ default: () => <div data-testid="graph-view" /> }))

const key = (name: string) => new RegExp(`(?:^|\\.)graph\\.${name}(?=$|:)`)

const stats = (overrides: Record<string, unknown> = {}) => ({
  entity_count: 0,
  relation_count: 0,
  entity_types: {},
  failed_chunk_count: 0,
  last_error: null,
  last_failed_at: null,
  building: false,
  ...overrides,
})

const acme = {
  id: 'e1',
  name: 'acme',
  display_name: 'Acme',
  entity_type: 'ORGANIZATION',
  description: '',
  frequency: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGraphEnabled = true
  queries.stats = {}
  queries.graph = { data: { entities: [], relations: [] } }
})

describe('KnowledgeGraph states', () => {
  it('shows a spinner, not "no graph yet", while extraction is still running', () => {
    queries.stats = { data: stats({ building: true }) }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(within(screen.getByRole('status')).getByText(key('buildingTitle'))).toBeInTheDocument()
    expect(screen.queryByText(key('emptyTitle'))).not.toBeInTheDocument()
  })

  it('explains a failed extraction and retries it', () => {
    queries.stats = {
      data: stats({
        failed_chunk_count: 4,
        last_error: 'User location is not supported for the API use.',
      }),
    }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('extractionFailedTitle'))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'User location is not supported for the API use.',
    )
    expect(screen.queryByText(key('emptyTitle'))).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: key('retry') }))
    expect(mockRetry).toHaveBeenCalledWith({ params: { dataset_id: 'dataset-1' } })
  })

  it('reports a failed request instead of an empty graph', () => {
    queries.stats = { isError: true, error: new Error('Failed to fetch') }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('loadFailedTitle'))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    fireEvent.click(screen.getByRole('button', { name: key('retry') }))
    expect(mockRefetch).toHaveBeenCalled()
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it('says "no graph yet" only when nothing failed and nothing is running', () => {
    queries.stats = { data: stats() }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('emptyTitle'))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: key('retry') })).not.toBeInTheDocument()
  })

  it('warns that a partial graph is missing failed chunks and offers a retry', () => {
    queries.stats = {
      data: stats({ entity_count: 1, failed_chunk_count: 3, last_error: '503 UNAVAILABLE' }),
    }
    queries.graph = {
      data: { entities: [{ id: 'e1', name: 'acme', display_name: 'Acme' }], relations: [] },
    }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByTestId('graph-view')).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByText(key('partialFailure'))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('503 UNAVAILABLE')
    fireEvent.click(screen.getByRole('button', { name: key('retry') }))
    expect(mockRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps showing a partial graph while a build extends it', () => {
    queries.stats = { data: stats({ entity_count: 1, failed_chunk_count: 3, building: true }) }
    queries.graph = {
      data: { entities: [{ id: 'e1', name: 'acme', display_name: 'Acme' }], relations: [] },
    }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByTestId('graph-view')).toBeInTheDocument()
    expect(
      within(screen.getByRole('status')).getByText(key('buildingDescription')),
    ).toBeInTheDocument()
    // A retry is pointless while one is already running.
    expect(screen.queryByRole('button', { name: key('retry') })).not.toBeInTheDocument()
  })
})

describe('KnowledgeGraph actions', () => {
  it('points to the settings when the graph is turned off', () => {
    mockGraphEnabled = false

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('disabledTitle'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: key('goToSettings') }))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/settings')
  })

  it('lets a failed extraction be fixed from the settings', () => {
    queries.stats = { data: stats({ failed_chunk_count: 2, last_error: 'Invalid API key' }) }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    fireEvent.click(screen.getByRole('button', { name: key('goToSettings') }))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/settings')
  })

  it('refreshes the stats once a retry is queued, so the page switches to building', () => {
    queries.stats = { data: stats({ failed_chunk_count: 2, last_error: '503 UNAVAILABLE' }) }

    render(<KnowledgeGraph datasetId="dataset-1" />)
    fireEvent.click(screen.getByRole('button', { name: key('retry') }))

    expect(mockRefetch).toHaveBeenCalled()
  })

  it('polls the stats only while a build is running', () => {
    queries.stats = { data: stats() }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    const { refetchInterval } = queryOptions.stats as StatsPollOptions
    expect(refetchInterval({ state: { data: { building: true } } })).toBe(3000)
    expect(refetchInterval({ state: { data: { building: false } } })).toBe(false)
    expect(refetchInterval({ state: {} })).toBe(false)
  })
})

describe('KnowledgeGraph explorer', () => {
  beforeEach(() => {
    queries.stats = { data: stats({ entity_count: 1, entity_types: { ORGANIZATION: 1 } }) }
    queries.graph = { data: { entities: [acme], relations: [] } }
  })

  it('focuses the graph on an entity picked from the list and clears it again', () => {
    render(<KnowledgeGraph datasetId="dataset-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    expect(screen.getByText(key('focusedOn'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: key('clearFocus') }))
    expect(screen.queryByText(key('focusedOn'))).not.toBeInTheDocument()
  })

  it('replaces a clicked focus with what the user types', () => {
    render(<KnowledgeGraph datasetId="dataset-1" />)
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))

    fireEvent.change(screen.getByRole('searchbox', { name: key('searchPlaceholder') }), {
      target: { value: 'globex' },
    })

    expect(screen.getByRole('searchbox', { name: key('searchPlaceholder') })).toHaveValue('globex')
    expect(screen.queryByText(key('focusedOn'))).not.toBeInTheDocument()
  })

  it('says when a search matches nothing instead of drawing an empty canvas', () => {
    queries.graph = { data: { entities: [], relations: [] } }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('noMatch'))).toBeInTheDocument()
    expect(screen.queryByTestId('graph-view')).not.toBeInTheDocument()
  })

  it('shows a spinner while the subgraph loads', () => {
    queries.graph = { isLoading: true }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByLabelText(/loading/)).toBeInTheDocument()
    expect(screen.queryByTestId('graph-view')).not.toBeInTheDocument()
  })

  it('reports a failed subgraph request and retries it', () => {
    queries.graph = { isError: true, error: new Error('Failed to fetch') }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByText(key('loadFailedTitle'))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    fireEvent.click(screen.getByRole('button', { name: key('retry') }))
    expect(mockRefetch).toHaveBeenCalled()
    expect(mockRetry).not.toHaveBeenCalled()
  })
})

describe('KnowledgeGraph loading', () => {
  it('waits for the stats before deciding which state to show', () => {
    queries.stats = { isLoading: true }

    render(<KnowledgeGraph datasetId="dataset-1" />)

    expect(screen.getByLabelText(/loading/)).toBeInTheDocument()
    expect(screen.queryByText(key('emptyTitle'))).not.toBeInTheDocument()
  })

  it('reloads the subgraph once when a build finishes', () => {
    queries.stats = { data: stats({ entity_count: 1, building: true }) }
    queries.graph = { data: { entities: [acme], relations: [] } }
    const { rerender } = render(<KnowledgeGraph datasetId="dataset-1" />)
    expect(mockRefetch).not.toHaveBeenCalled()

    // The last poll can land before the final batch is written.
    queries.stats = { data: stats({ entity_count: 1, building: false }) }
    rerender(<KnowledgeGraph datasetId="dataset-1" />)

    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })
})
