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

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: () => queryMock,
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

  it('offers a real retry for recoverable loading errors', async () => {
    const user = userEvent.setup()
    queryMock.error = new Error('temporary failure')

    render(<KnowledgeSpaceShell knowledgeSpaceId="space-1">source content</KnowledgeSpaceShell>)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })
})
