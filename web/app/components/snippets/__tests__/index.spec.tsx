import type { SnippetDetailPayload } from '@/models/snippet'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetPage from '..'
import { useSnippetDetailStore } from '../store'

const mockUseSnippetInit = vi.fn()

vi.mock('../hooks/use-snippet-init', () => ({
  useSnippetInit: (snippetId: string) => mockUseSnippetInit(snippetId),
}))

vi.mock('../hooks/use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'snippet-1',
    flowType: 'snippet',
    fileSettings: {},
  }),
}))

vi.mock('../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
}))

vi.mock('../hooks/use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
}))

vi.mock('@/service/use-snippets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-snippets')>()

  return {
    ...actual,
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

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: undefined,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile', desktop: 'desktop' },
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-default-context">{children}</div>
  ),
  WorkflowWithInnerContext: ({ children, viewport }: { children: React.ReactNode, viewport?: { zoom?: number } }) => (
    <div data-testid="workflow-inner-context">
      <span data-testid="workflow-viewport-zoom">{viewport?.zoom ?? 'none'}</span>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
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

vi.mock('@/app/components/workflow/panel', () => ({
  default: ({ components }: { components?: { left?: React.ReactNode, right?: React.ReactNode } }) => (
    <div data-testid="workflow-panel">
      <div data-testid="workflow-panel-left">{components?.left}</div>
      <div data-testid="workflow-panel-right">{components?.right}</div>
    </div>
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

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  inputFields: [
    {
      type: PipelineInputVarType.textInput,
      label: 'Blog URL',
      variable: 'blog_url',
      required: true,
      options: [],
      placeholder: 'Paste a source article URL',
      max_length: 256,
    },
  ],
  uiMeta: {
    inputFieldCount: 1,
    checklistCount: 2,
    autoSavedAt: 'Auto-saved · a few seconds ago',
  },
}

describe('SnippetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSnippetDetailStore.getState().reset()
    mockUseSnippetInit.mockReturnValue({
      data: mockSnippetDetail,
      isLoading: false,
    })
  })

  it('should render the snippet detail shell', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
    expect(screen.getByText('A static snippet mock.')).toBeInTheDocument()
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-default-context')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-viewport-zoom').textContent).toBe('1')
  })

  it('should open the input field panel and editor', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: /snippet\.inputFieldButton/i })[0])
    expect(screen.getAllByText('snippet.panelTitle').length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: /datasetPipeline\.inputFieldPanel\.addInputField/i })[0])
    expect(screen.getAllByText('datasetPipeline.inputFieldPanel.addInputField').length).toBeGreaterThan(1)
  })

  it('should toggle the publish menu', () => {
    render(<SnippetPage snippetId="snippet-1" />)

    fireEvent.click(screen.getByRole('button', { name: /snippet\.publishButton/i }))
    expect(screen.getByText('snippet.publishMenuCurrentDraft')).toBeInTheDocument()
  })

  it('should render loading fallback when snippet data is unavailable', () => {
    mockUseSnippetInit.mockReturnValue({
      data: null,
      isLoading: false,
    })

    render(<SnippetPage snippetId="missing-snippet" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
