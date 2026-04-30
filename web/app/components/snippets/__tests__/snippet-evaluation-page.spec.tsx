import type { SnippetDetailPayload } from '@/models/snippet'
import type { Snippet } from '@/types/snippet'
import { render, screen } from '@testing-library/react'
import SnippetEvaluationPage from '../snippet-evaluation-page'

const mockUseSnippetApiDetail = vi.fn()
const mockSetAppSidebarExpand = vi.fn()
const mockUseDocumentTitle = vi.fn()

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

vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => mockUseDocumentTitle(title),
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

const mockSnippetDetail: SnippetDetailPayload = {
  snippet: {
    id: 'snippet-1',
    name: 'Tone Rewriter',
    description: 'A static snippet mock.',
    updatedAt: '2024-03-24',
    usage: '19',
    icon: '🪄',
    iconBackground: '#E0EAFF',
  },
  graph: {
    nodes: [],
    edges: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
  },
  inputFields: [],
  uiMeta: {
    inputFieldCount: 0,
    checklistCount: 0,
    autoSavedAt: '2024-03-24 12:00',
  },
}

const mockSnippetApiDetail: Snippet = {
  id: mockSnippetDetail.snippet.id,
  name: mockSnippetDetail.snippet.name,
  description: mockSnippetDetail.snippet.description,
  type: 'node',
  version: '1',
  use_count: 19,
  icon_info: {
    icon: mockSnippetDetail.snippet.icon,
    icon_background: mockSnippetDetail.snippet.iconBackground,
    icon_type: 'emoji',
  },
  input_fields: [],
  created_at: 1711267200,
  created_by: 'user-1',
  updated_at: 1711267200,
  updated_by: 'user-1',
  is_published: true,
}

describe('SnippetEvaluationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetApiDetail.mockReturnValue({
      data: mockSnippetApiDetail,
      isLoading: false,
    })
  })

  it('should render evaluation with snippet detail data from api', () => {
    render(<SnippetEvaluationPage snippetId="snippet-1" />)

    expect(mockUseSnippetApiDetail).toHaveBeenCalledWith('snippet-1')
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('evaluation')).toHaveTextContent('snippet-1')
  })
})
