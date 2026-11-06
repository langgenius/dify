import type { SnippetDetail } from '@/models/snippet'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SnippetLayout from '../snippet-layout'

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
    document.title = ''
  })

  it('updates the document title when snippet metadata loads', () => {
    const { rerender } = render(
      <SnippetLayout snippetId="snippet-1" section="orchestrate">
        <div>content</div>
      </SnippetLayout>,
    )

    expect(document.title).toBe('snippet.typeLabel - Dify')
    rerender(
      <SnippetLayout snippetId="snippet-1" snippet={createSnippet()} section="orchestrate">
        <div>content</div>
      </SnippetLayout>,
    )
    expect(document.title).toBe('Snippet Title - Dify')
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
