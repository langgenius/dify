import type { SnippetDetailPayload } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import { MAIN_CONTENT_ID } from '@/app/components/main-nav/skip-nav'
import SnippetPage from '..'

const mockUseSnippetInit = vi.fn()
let capturedWorkflowDefaultContextProps: {
  nodes: unknown[]
  edges: unknown[]
} | undefined

vi.mock('../hooks/use-snippet-init', () => ({
  useSnippetInit: (snippetId: string) => mockUseSnippetInit(snippetId),
}))

vi.mock('../components/snippet-main', () => ({
  default: ({
    hasPublishedWorkflow,
    snippetId,
  }: {
    hasPublishedWorkflow: boolean
    snippetId: string
  }) => <div data-testid="snippet-main">{`${snippetId}:${String(hasPublishedWorkflow)}`}</div>,
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

vi.mock('@/app/components/detail-sidebar', () => ({
  DetailSidebarFrame: () => <aside data-testid="detail-sidebar-frame" />,
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({
    children,
    nodes,
    edges,
  }: {
    children: React.ReactNode
    nodes: unknown[]
    edges: unknown[]
  }) => {
    capturedWorkflowDefaultContextProps = {
      nodes,
      edges,
    }

    return (
      <div data-testid="workflow-default-context">{children}</div>
    )
  },
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

const createSnippetDetailPayload = (nodeId: string, edgeId: string): SnippetDetailPayload => ({
  snippet: {
    id: 'snippet-1',
    name: 'Tone Rewriter',
    description: 'A static snippet mock.',
    updatedAt: 'Updated 2h ago',
    usage: 'Used 19 times',
    tags: [],
    status: 'Draft',
  },
  graph: {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{
      id: nodeId,
      position: { x: 0, y: 0 },
      data: { title: nodeId },
    }] as SnippetDetailPayload['graph']['nodes'],
    edges: [{
      id: edgeId,
      source: nodeId,
      target: `${nodeId}-target`,
    }] as SnippetDetailPayload['graph']['edges'],
  },
  inputFields: [],
  uiMeta: {
    inputFieldCount: 0,
    checklistCount: 0,
    autoSavedAt: 'Auto-saved · a few seconds ago',
  },
})

const mockPublishedSnippetDetail = createSnippetDetailPayload('published-node', 'published-edge')
const mockDraftSnippetDetail = createSnippetDetailPayload('draft-node', 'draft-edge')

describe('SnippetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedWorkflowDefaultContextProps = undefined
    mockUseSnippetInit.mockReturnValue({
      data: {
        snippet: mockDraftSnippetDetail.snippet,
        published: mockPublishedSnippetDetail,
        draft: mockDraftSnippetDetail,
        draftWorkflow: {
          hash: 'draft-hash',
        },
        publishedWorkflow: {
          hash: 'published-hash',
        },
        hasDraftChanges: true,
      },
      isLoading: false,
    })
  })

  it('should render the orchestrate route shell with independent main content', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-default-context')).toBeInTheDocument()
    expect(screen.getByTestId('snippet-main')).toHaveTextContent('snippet-1')
  })

  it('should initialize workflow context with published graph data when the published workflow exists', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    expect(capturedWorkflowDefaultContextProps?.nodes).toEqual(mockPublishedSnippetDetail.graph.nodes)
    expect(capturedWorkflowDefaultContextProps?.edges).toEqual(mockPublishedSnippetDetail.graph.edges)
    expect(screen.getByTestId('snippet-main')).toHaveTextContent('snippet-1:true')
  })

  it('should initialize workflow context with draft graph data when the published workflow is empty', () => {
    mockUseSnippetInit.mockReturnValue({
      data: {
        snippet: mockDraftSnippetDetail.snippet,
        published: mockPublishedSnippetDetail,
        draft: mockDraftSnippetDetail,
        draftWorkflow: {
          hash: 'draft-hash',
        },
        publishedWorkflow: undefined,
        hasDraftChanges: true,
      },
      isLoading: false,
    })

    render(<SnippetPage snippetId="snippet-1" />)

    expect(capturedWorkflowDefaultContextProps?.nodes).toEqual(mockDraftSnippetDetail.graph.nodes)
    expect(capturedWorkflowDefaultContextProps?.edges).toEqual(mockDraftSnippetDetail.graph.edges)
    expect(screen.getByTestId('snippet-main')).toHaveTextContent('snippet-1:false')
  })

  it('should render loading fallback when orchestrate data is unavailable', () => {
    mockUseSnippetInit.mockReturnValue({
      data: null,
      isLoading: false,
    })

    render(<SnippetPage snippetId="missing-snippet" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should keep the detail route shell while orchestrate data is loading', () => {
    mockUseSnippetInit.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    render(<SnippetPage snippetId="snippet-1" />)

    const main = screen.getByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID)
    expect(main).toContainElement(screen.getByRole('status'))
    expect(screen.getByTestId('detail-sidebar-frame')).toBeInTheDocument()
  })
})
