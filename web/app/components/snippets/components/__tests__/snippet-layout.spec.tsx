import type { SnippetDetail } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import SnippetLayout from '../snippet-layout'

const mockUseDocumentTitle = vi.fn()

vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => mockUseDocumentTitle(title),
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

  it('sets the document title and leaves navigation to the parent layout', () => {
    render(
      <SnippetLayout snippetId="snippet-1" snippet={createSnippet()} section="orchestrate">
        <div>content</div>
      </SnippetLayout>,
    )

    expect(mockUseDocumentTitle).toHaveBeenCalledWith('Snippet Title')
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'snippet.sectionOrchestrate' }),
    ).not.toBeInTheDocument()
  })
})
