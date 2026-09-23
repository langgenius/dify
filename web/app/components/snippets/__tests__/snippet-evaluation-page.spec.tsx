import type { Snippet } from '@/types/snippet'
import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import SnippetEvaluationPage from '../snippet-evaluation-page'

const mockReplace = vi.fn()
const mockUseSnippetApiDetail = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/service/use-snippets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-snippets')>()

  return {
    ...actual,
    useSnippetApiDetail: (snippetId: string) => mockUseSnippetApiDetail(snippetId),
  }
})

vi.mock('@/app/components/evaluation', () => ({
  default: ({ resourceId }: { resourceId: string }) => (
    <div data-testid="evaluation">{resourceId}</div>
  ),
}))

vi.mock('../components/snippet-layout', () => ({
  default: ({ children, section }: { children: React.ReactNode; section: string }) => (
    <div data-section={section}>{children}</div>
  ),
}))

const createSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 'snippet-1',
  name: 'Tone Rewriter',
  description: 'A snippet fixture.',
  type: 'node',
  version: 1,
  use_count: 19,
  graph: {},
  input_fields: [],
  tags: [],
  created_at: 1,
  created_by: null,
  updated_at: 1,
  updated_by: null,
  is_published: true,
  ...overrides,
})

describe('SnippetEvaluationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetApiDetail.mockReturnValue({
      data: createSnippet(),
      isLoading: false,
    })
  })

  it('renders evaluation for a published snippet', () => {
    renderWithConsoleQuery(<SnippetEvaluationPage snippetId="snippet-1" />)

    expect(mockUseSnippetApiDetail).toHaveBeenCalledWith('snippet-1')
    expect(screen.getByTestId('evaluation')).toHaveTextContent('snippet-1')
    expect(screen.getByTestId('evaluation').parentElement).toHaveAttribute(
      'data-section',
      'evaluation',
    )
  })

  it('redirects an unpublished snippet to orchestrate', async () => {
    mockUseSnippetApiDetail.mockReturnValue({
      data: createSnippet({ is_published: false }),
      isLoading: false,
    })

    renderWithConsoleQuery(<SnippetEvaluationPage snippetId="snippet-1" />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/snippets/snippet-1/orchestrate')
    })
    expect(screen.queryByTestId('evaluation')).not.toBeInTheDocument()
  })
})
