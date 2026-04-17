import type { PublishedSnippetListItem } from '../snippet-detail-card'
import { render, screen } from '@testing-library/react'
import SnippetDetailCard from '../snippet-detail-card'

const mockUseSnippetPublishedWorkflow = vi.fn()

vi.mock('@/service/use-snippet-workflows', () => ({
  useSnippetPublishedWorkflow: (...args: unknown[]) => mockUseSnippetPublishedWorkflow(...args),
}))

const createSnippet = (overrides: Partial<PublishedSnippetListItem> = {}): PublishedSnippetListItem => ({
  id: 'snippet-1',
  name: 'Customer Review',
  description: 'Snippet description',
  author: 'Evan',
  type: 'group',
  is_published: true,
  use_count: 3,
  icon_info: {
    icon_type: 'emoji',
    icon: '🧾',
    icon_background: '#FFEAD5',
    icon_url: '',
  },
  created_at: 1,
  updated_at: 2,
  ...overrides,
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
