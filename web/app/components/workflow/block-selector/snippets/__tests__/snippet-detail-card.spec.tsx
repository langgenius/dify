import type { SnippetListItem } from '@/types/snippet'
import { render, screen } from '@testing-library/react'
import SnippetDetailCard from '../snippet-detail-card'

const mockUseSnippetPublishedWorkflow = vi.fn()

vi.mock('@/service/use-snippet-workflows', () => ({
  useSnippetPublishedWorkflow: (...args: unknown[]) => mockUseSnippetPublishedWorkflow(...args),
}))

const createSnippet = (overrides: Partial<SnippetListItem> = {}): SnippetListItem => ({
  id: 'snippet-1',
  name: 'Customer Review',
  description: 'Snippet description',
  type: 'group',
  is_published: true,
  use_count: 3,
  tags: [],
  created_at: 1,
  created_by: 'user-1',
  author_name: 'Evan',
  updated_at: 2,
  updated_by: 'user-1',
  ...overrides,
  version: overrides.version ?? 1,
})

describe('SnippetDetailCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetPublishedWorkflow.mockReturnValue({ data: undefined })
  })

  describe('Rendering', () => {
    it('should render snippet summary information', () => {
      render(<SnippetDetailCard snippet={createSnippet()} />)

      expect(screen.getByText('Customer Review')).toBeInTheDocument()
      expect(screen.getByText('Snippet description')).toBeInTheDocument()
      expect(screen.getByText('Evan')).toBeInTheDocument()
    })

    it('should render the unknown user label when the author name is unavailable', () => {
      render(<SnippetDetailCard snippet={createSnippet({ author_name: null })} />)

      expect(screen.getByText('snippet.unknownUser')).toBeInTheDocument()
    })

    it('should render unique block icons from published workflow graph', () => {
      mockUseSnippetPublishedWorkflow.mockReturnValue({
        data: {
          graph: {
            nodes: [
              { data: { type: 'llm' } },
              { data: { type: 'code' } },
              { data: { type: 'llm' } },
              { data: { type: 'unknown' } },
            ],
          },
        },
      })

      const { container } = render(<SnippetDetailCard snippet={createSnippet()} />)

      expect(container.querySelectorAll('[data-icon="Llm"], [data-icon="Code"]')).toHaveLength(2)
    })
  })
})
