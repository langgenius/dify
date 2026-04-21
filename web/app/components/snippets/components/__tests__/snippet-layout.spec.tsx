import type { ReactNode } from 'react'
import type { SnippetDetail } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import SnippetLayout from '../snippet-layout'

const mockSetAppSidebarExpand = vi.fn()
const mockUseDocumentTitle = vi.fn()

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
    desktop: 'desktop',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => mockUseDocumentTitle(title),
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: ({
    renderHeader,
    renderNavigation,
  }: {
    renderHeader?: (mode: string) => ReactNode
    renderNavigation?: (mode: string) => ReactNode
  }) => (
    <div data-testid="app-sidebar">
      {renderHeader?.('expand')}
      {renderNavigation?.('expand')}
    </div>
  ),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ name, href, active, disabled }: { name: string, href: string, active: boolean, disabled?: boolean }) => (
    disabled
      ? (
          <button type="button" disabled>
            {name}
          </button>
        )
      : (
          <a
            aria-current={active ? 'page' : undefined}
            href={href}
          >
            {name}
          </a>
        )
  ),
}))

vi.mock('@/app/components/app-sidebar/snippet-info', () => ({
  default: ({ snippet }: { snippet: SnippetDetail }) => <div>{snippet.name}</div>,
}))

const createSnippet = (overrides: Partial<SnippetDetail> = {}): SnippetDetail => ({
  id: 'snippet-1',
  name: 'Snippet Title',
  description: 'Snippet description',
  author: 'tester',
  updatedAt: '2026-04-15',
  usage: '42',
  icon: 'emoji',
  iconBackground: '#ffffff',
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

  describe('Navigation', () => {
    it('should render snippet navigation links', () => {
      render(
        <SnippetLayout
          snippetId="snippet-1"
          snippet={createSnippet()}
          section="evaluation"
        >
          <div>content</div>
        </SnippetLayout>,
      )

      expect(screen.getByRole('link', { name: 'snippet.sectionOrchestrate' })).toHaveAttribute('href', '/snippets/snippet-1/orchestrate')
      expect(screen.getByRole('link', { name: 'snippet.sectionEvaluation' })).toHaveAttribute('href', '/snippets/snippet-1/evaluation')
      expect(screen.getByRole('link', { name: 'snippet.sectionEvaluation' })).toHaveAttribute('aria-current', 'page')
    })

    it('should disable the evaluation menu when the snippet is unpublished', () => {
      render(
        <SnippetLayout
          snippetId="snippet-1"
          snippet={createSnippet({ is_published: false })}
          section="orchestrate"
        >
          <div>content</div>
        </SnippetLayout>,
      )

      expect(screen.getByRole('button', { name: 'snippet.sectionEvaluation' })).toBeDisabled()
      expect(screen.queryByRole('link', { name: 'snippet.sectionEvaluation' })).not.toBeInTheDocument()
    })
  })
})
