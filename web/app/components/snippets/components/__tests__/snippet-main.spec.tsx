import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetInputField, SnippetSection } from '@/models/snippet'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetMain from '../snippet-main'

const mockSetAppSidebarExpand = vi.fn()
const mockSyncInputFieldsDraft = vi.fn()
const mockCloseEditor = vi.fn()
const mockOpenEditor = vi.fn()
const mockReset = vi.fn()
const mockSetInputPanelOpen = vi.fn()
const mockSetPublishMenuOpen = vi.fn()
const mockToggleInputPanel = vi.fn()
const mockTogglePublishMenu = vi.fn()
const mockPublishSnippetMutateAsync = vi.fn()

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile', desktop: 'desktop' },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/app/components/snippets/store', () => ({
  useSnippetDetailStore: (selector: (state: {
    editingField: SnippetInputField | null
    isEditorOpen: boolean
    isInputPanelOpen: boolean
    isPublishMenuOpen: boolean
    closeEditor: typeof mockCloseEditor
    openEditor: typeof mockOpenEditor
    reset: typeof mockReset
    setInputPanelOpen: typeof mockSetInputPanelOpen
    setPublishMenuOpen: typeof mockSetPublishMenuOpen
    toggleInputPanel: typeof mockToggleInputPanel
    togglePublishMenu: typeof mockTogglePublishMenu
  }) => unknown) => selector({
    editingField: null,
    isEditorOpen: false,
    isInputPanelOpen: true,
    isPublishMenuOpen: false,
    closeEditor: mockCloseEditor,
    openEditor: mockOpenEditor,
    reset: mockReset,
    setInputPanelOpen: mockSetInputPanelOpen,
    setPublishMenuOpen: mockSetPublishMenuOpen,
    toggleInputPanel: mockToggleInputPanel,
    togglePublishMenu: mockTogglePublishMenu,
  }),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  usePublishSnippetWorkflowMutation: () => ({
    mutateAsync: mockPublishSnippetMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'snippet-1',
    flowType: 'snippet',
    fileSettings: {},
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncInputFieldsDraft: mockSyncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
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
      <div>{renderHeader?.('expand')}</div>
      <div>{renderNavigation?.('expand')}</div>
    </div>
  ),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ name }: { name: string }) => <div>{name}</div>,
}))

vi.mock('@/app/components/app-sidebar/snippet-info', () => ({
  default: () => <div data-testid="snippet-info" />,
}))

vi.mock('@/app/components/evaluation', () => ({
  default: () => <div data-testid="evaluation" />,
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-inner-context">{children}</div>
  ),
}))

vi.mock('@/app/components/snippets/components/snippet-children', () => ({
  default: ({
    onRemoveField,
    onPublish,
    onSubmitField,
  }: {
    onRemoveField: (index: number) => void
    onPublish: () => void
    onSubmitField: (field: SnippetInputField) => void
  }) => (
    <div>
      <button type="button" onClick={() => onRemoveField(0)}>remove</button>
      <button type="button" onClick={onPublish}>publish</button>
      <button
        type="button"
        onClick={() => onSubmitField({
          type: PipelineInputVarType.textInput,
          label: 'New Field',
          variable: 'new_field',
          required: true,
        })}
      >
        submit
      </button>
    </div>
  ),
}))

const payload: SnippetDetailPayload = {
  snippet: {
    id: 'snippet-1',
    name: 'Snippet',
    description: 'desc',
    author: '',
    updatedAt: '2026-03-29 10:00',
    usage: '0',
    icon: '',
    iconBackground: '',
  },
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  inputFields: [
    {
      type: PipelineInputVarType.textInput,
      label: 'Blog URL',
      variable: 'blog_url',
      required: true,
    },
  ],
  uiMeta: {
    inputFieldCount: 1,
    checklistCount: 0,
    autoSavedAt: '2026-03-29 10:00',
  },
}

const renderSnippetMain = (section: SnippetSection = 'orchestrate') => {
  return render(
    <SnippetMain
      payload={payload}
      snippetId="snippet-1"
      section={section}
      nodes={[] as WorkflowProps['nodes']}
      edges={[] as WorkflowProps['edges']}
      viewport={{ x: 0, y: 0, zoom: 1 }}
    />,
  )
}

describe('SnippetMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
    mockPublishSnippetMutateAsync.mockResolvedValue(undefined)
  })

  describe('Input Fields Sync', () => {
    it('should sync draft input_fields when removing a field from the panel', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'remove' }))

      await waitFor(() => {
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([], {
          onRefresh: expect.any(Function),
        })
      })
    })

    it('should sync draft input_fields when submitting a field from the editor', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'submit' }))

      await waitFor(() => {
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([
          payload.inputFields[0],
          {
            type: PipelineInputVarType.textInput,
            label: 'New Field',
            variable: 'new_field',
            required: true,
          },
        ], {
          onRefresh: expect.any(Function),
        })
      })
    })
  })

  describe('Publish', () => {
    it('should call the publish mutation and close the publish menu', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      })
      expect(mockSetPublishMenuOpen).toHaveBeenCalledWith(false)
    })
  })
})
