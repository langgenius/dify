import type { SnippetDetailPayload } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import SnippetEvaluationPage from '../snippet-evaluation-page'

const mockUseSnippetApiDetail = vi.fn()
const mockGetSnippetDetailMock = vi.fn()
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

vi.mock('@/service/use-snippets.mock', () => ({
  getSnippetDetailMock: (snippetId: string) => mockGetSnippetDetailMock(snippetId),
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

const mockSnippetDetail: SnippetDetailPayload = {
  snippet: {
    id: 'snippet-1',
    name: 'Tone Rewriter',
    description: 'A static snippet mock.',
    author: 'Evan',
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

describe('SnippetEvaluationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetApiDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
    mockGetSnippetDetailMock.mockReturnValue(mockSnippetDetail)
  })

  it('should render evaluation with mock snippet detail data', () => {
    render(<SnippetEvaluationPage snippetId="snippet-1" />)

    expect(mockGetSnippetDetailMock).toHaveBeenCalledWith('snippet-1')
    expect(mockUseSnippetApiDetail).not.toHaveBeenCalled()
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('evaluation')).toHaveTextContent('snippet-1')
  })
})
