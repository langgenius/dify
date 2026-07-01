import type { SnippetDetail } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import SnippetLayout from '../snippet-layout'

const mockUseDocumentTitle = vi.fn()

vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => mockUseDocumentTitle(title),
}))

vi.mock('@/app/components/detail-sidebar', () => ({
  DetailSidebarFrame: () => <aside data-testid="detail-sidebar-frame" />,
}))

const createSnippet = (overrides: Partial<SnippetDetail> = {}): SnippetDetail => ({
  id: 'snippet-1',
  name: 'Snippet Title',
  description: 'Snippet description',
  updatedAt: '2026-04-15',
  usage: '42',
  tags: [],
  is_published: true,
  ...overrides,
})

describe('SnippetLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('Document title', () => {
    it('should set the document title to the snippet name when snippet detail is available', () => {
      render(
        <SnippetLayout
          snippetId="snippet-1"
          snippet={createSnippet()}
          section="orchestrate"
        >
          <div>content</div>
        </SnippetLayout>,
      )

      expect(mockUseDocumentTitle).toHaveBeenCalledWith('Snippet Title')
    })
  })

  describe('Layout', () => {
    it('should render the detail content without the app detail sidebar navigation', () => {
      render(
        <SnippetLayout
          snippetId="snippet-1"
          snippet={createSnippet()}
          section="orchestrate"
        >
          <div>content</div>
        </SnippetLayout>,
      )

      expect(screen.getByText('content')).toBeInTheDocument()
      expect(screen.getByTestId('detail-sidebar-frame')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'snippet.sectionOrchestrate' })).not.toBeInTheDocument()
    })
  })
})
