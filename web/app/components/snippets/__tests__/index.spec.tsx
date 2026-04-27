import type { SnippetDetailPayload } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import SnippetPage from '..'

const mockUseSnippetInit = vi.fn()
const mockSetAppSidebarExpand = vi.fn()

vi.mock('../hooks/use-snippet-init', () => ({
  useSnippetInit: (snippetId: string) => mockUseSnippetInit(snippetId),
}))

vi.mock('../components/snippet-main', () => ({
  default: ({ snippetId }: { snippetId: string }) => <div data-testid="snippet-main">{snippetId}</div>,
}))

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
  default: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-default-context">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()

  return {
    ...actual,
    initialNodes: (nodes: unknown[]) => nodes,
    initialEdges: (edges: unknown[]) => edges,
  }
})

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

vi.mock('@/app/components/app-sidebar/snippet-info', () => ({
  default: () => <div data-testid="snippet-info" />,
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
    updatedAt: 'Updated 2h ago',
    usage: 'Used 19 times',
    icon: '🪄',
    iconBackground: '#E0EAFF',
    status: 'Draft',
  },
  graph: {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  },
  inputFields: [],
  uiMeta: {
    inputFieldCount: 0,
    checklistCount: 0,
    autoSavedAt: 'Auto-saved · a few seconds ago',
  },
}

describe('SnippetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSnippetInit.mockReturnValue({
      data: mockSnippetDetail,
      isLoading: false,
    })
  })

  it('should render the orchestrate route shell with independent main content', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('snippet-info')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-default-context')).toBeInTheDocument()
    expect(screen.getByTestId('snippet-main')).toHaveTextContent('snippet-1')
  })

  it('should render loading fallback when orchestrate data is unavailable', () => {
    mockUseSnippetInit.mockReturnValue({
      data: null,
      isLoading: false,
    })

    render(<SnippetPage snippetId="missing-snippet" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
