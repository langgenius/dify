import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSpaceShell } from '../knowledge-space-shell'

const queryMock = vi.hoisted(() => ({
  data: undefined as
    | {
        id: string
        name: string
      }
    | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const queryOptionsMock = vi.hoisted(() => vi.fn(() => ({})))
const useQueryOptionsMock = vi.hoisted(() => vi.fn())
const pathnameMock = vi.hoisted(() => ({ value: '/datasets/new/space-1/sources' }))

vi.mock('@/next/navigation', () => ({
  usePathname: () => pathnameMock.value,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: unknown) => {
      useQueryOptionsMock(options)
      return queryMock
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesById: {
        queryOptions: queryOptionsMock,
      },
    },
  },
}))

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))

describe('KnowledgeSpaceShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
    queryMock.error = null
    queryMock.isPending = false
    pathnameMock.value = '/datasets/new/space-1/sources'
  })

  it('loads the real knowledge space contract by route id', () => {
    queryMock.isPending = true

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">content</KnowledgeSpaceShell>)

    expect(queryOptionsMock).toHaveBeenCalledWith({ input: { params: { id: 'space-1' } } })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders a refresh-safe header and route navigation when loaded', () => {
    queryMock.data = { id: 'space-1', name: 'Support knowledge' }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)

    expect(screen.getByRole('heading', { name: 'Support knowledge' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.sources' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources',
    )
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.sources' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.documents' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/documents',
    )
    expect(screen.getByText('source content')).toBeInTheDocument()
  })

  it('shows a not-found state without rendering children', () => {
    queryMock.error = { status: 404 }

    render(<KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('source content')).not.toBeInTheDocument()
  })

  it('recognizes the nested status shape returned by the ORPC client', () => {
    queryMock.error = { data: { status: 404 } }

    render(<KnowledgeSpaceShell knowledgeSpaceId="missing">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
  })

  it('treats forbidden detail responses as a terminal non-disclosing state', () => {
    queryMock.error = { data: { status: 403 } }

    render(<KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>)

    expect(screen.getByText('dataset.newKnowledge.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it.each([{ status: 403 }, { data: { status: 404 } }])(
    'does not automatically retry terminal detail errors shaped as $error',
    (error) => {
      queryMock.error = error

      render(<KnowledgeSpaceShell knowledgeSpaceId="private">source content</KnowledgeSpaceShell>)

      const options = useQueryOptionsMock.mock.lastCall?.[0] as {
        retry: (failureCount: number, queryError: unknown) => boolean
      }
      expect(options.retry(0, error)).toBe(false)
      expect(options.retry(2, new Error('temporary failure'))).toBe(true)
      expect(options.retry(3, new Error('temporary failure'))).toBe(false)
    },
  )

  it('marks Documents as the only current detail route', () => {
    pathnameMock.value = '/datasets/new/space-1/documents'
    queryMock.data = { id: 'space-1', name: 'Support knowledge' }

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">document content</KnowledgeSpaceShell>)

    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.sources' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.documents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('offers a real retry for recoverable loading errors', async () => {
    const user = userEvent.setup()
    queryMock.error = new Error('temporary failure')

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })
})
