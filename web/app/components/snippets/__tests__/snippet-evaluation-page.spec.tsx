import type { Snippet } from '@/types/snippet'
import { render, screen } from '@testing-library/react'
import SnippetEvaluationPage from '../snippet-evaluation-page'

const mockUseSnippetApiDetail = vi.fn()
const mockSetAppSidebarExpand = vi.fn()

vi.mock('@/service/use-snippets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-snippets')>()

  return {
    ...actual,
    useSnippetApiDetail: (snippetId: string) => mockUseSnippetApiDetail(snippetId),
    useUpdateSnippetMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useExportSnippetMutation: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useDeleteSnippetMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile', desktop: 'desktop' },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: ({
    renderHeader,
    renderNavigation,
  }: {
    renderHeader?: (modeState: string) => React.ReactNode
    renderNavigation?: (modeState: string) => React.ReactNode
  }) => (
    <div data-testid="app-sidebar">
      <div data-testid="app-sidebar-header">{renderHeader?.('expand')}</div>
      <div data-testid="app-sidebar-navigation">{renderNavigation?.('expand')}</div>
    </div>
  ),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ name, onClick }: { name: string, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{name}</button>
  ),
}))

vi.mock('@/app/components/evaluation', () => ({
  default: ({ resourceId }: { resourceId: string }) => <div data-testid="evaluation">{resourceId}</div>,
}))

const mockSnippetApiDetail: Snippet = {
  id: 'snippet-1',
  name: 'Tone Rewriter',
  description: 'A static snippet mock.',
  type: 'node',
  is_published: false,
  version: 'draft',
  use_count: 19,
  icon_info: {
    icon_type: 'emoji',
    icon: '🪄',
    icon_background: '#E0EAFF',
  },
  input_fields: [],
  created_at: 1_711_609_600,
  updated_at: 1_711_616_800,
  author: 'Evan',
}

describe('SnippetEvaluationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetApiDetail.mockReturnValue({
      data: mockSnippetApiDetail,
      isLoading: false,
    })
  })

  it('should fetch evaluation route data independently from snippet init', () => {
    render(<SnippetEvaluationPage snippetId="snippet-1" />)

    expect(mockUseSnippetApiDetail).toHaveBeenCalledWith('snippet-1')
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('evaluation')).toHaveTextContent('snippet-1')
  })
})
