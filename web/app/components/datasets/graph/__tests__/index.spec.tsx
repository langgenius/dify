import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import KnowledgeGraph from '../index'

type QueryState = {
  data?: unknown
  isLoading?: boolean
  isError?: boolean
  error?: unknown
}

const queries: Record<'stats' | 'graph', QueryState> = { stats: {}, graph: {} }
const mockRetry = vi.fn()
const mockRefetch = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey: ['stats' | 'graph'] }) => ({
      isLoading: false,
      isError: false,
      ...queries[options.queryKey[0]],
      refetch: mockRefetch,
    }),
    useMutation: () => ({ mutate: mockRetry, isPending: false }),
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
    selector({ dataset: { graph_index_setting: { enabled: true } } }),
}))

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

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

beforeEach(() => {
  vi.clearAllMocks()
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
