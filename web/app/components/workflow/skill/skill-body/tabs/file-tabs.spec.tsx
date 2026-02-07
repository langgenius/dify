import type { AppAssetTreeView } from '@/types/app-asset'
import { fireEvent, render, screen } from '@testing-library/react'
import { makeArtifactTabId, START_TAB_ID } from '../../constants'
import FileTabs from './file-tabs'

type MockWorkflowState = {
  openTabIds: string[]
  activeTabId: string | null
  previewTabId: string | null
  dirtyContents: Set<string>
  dirtyMetadataIds: Set<string>
}

const mocks = vi.hoisted(() => ({
  storeState: {
    openTabIds: [],
    activeTabId: '__start__',
    previewTabId: null,
    dirtyContents: new Set<string>(),
    dirtyMetadataIds: new Set<string>(),
  } as MockWorkflowState,
  nodeMap: undefined as Map<string, AppAssetTreeView> | undefined,
  activateTab: vi.fn(),
  pinTab: vi.fn(),
  closeTab: vi.fn(),
  clearDraftContent: vi.fn(),
  clearFileMetadata: vi.fn(),
  clearArtifactSelection: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      activateTab: mocks.activateTab,
      pinTab: mocks.pinTab,
      closeTab: mocks.closeTab,
      clearDraftContent: mocks.clearDraftContent,
      clearFileMetadata: mocks.clearFileMetadata,
      clearArtifactSelection: mocks.clearArtifactSelection,
    }),
  }),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetNodeMap: () => ({ data: mocks.nodeMap }),
}))

const createNode = (overrides: Partial<AppAssetTreeView> = {}): AppAssetTreeView => ({
  id: 'file-1',
  node_type: 'file',
  name: 'guide.md',
  path: '/guide.md',
  extension: 'md',
  size: 10,
  children: [],
  ...overrides,
})

const setMockState = (overrides: Partial<MockWorkflowState> = {}) => {
  mocks.storeState.openTabIds = overrides.openTabIds ?? []
  mocks.storeState.activeTabId = overrides.activeTabId ?? START_TAB_ID
  mocks.storeState.previewTabId = overrides.previewTabId ?? null
  mocks.storeState.dirtyContents = overrides.dirtyContents ?? new Set<string>()
  mocks.storeState.dirtyMetadataIds = overrides.dirtyMetadataIds ?? new Set<string>()
}

const setMockNodeMap = (nodes: AppAssetTreeView[] = []) => {
  mocks.nodeMap = new Map(nodes.map(node => [node.id, node]))
}

describe('FileTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockState()
    setMockNodeMap([])
  })

  // Rendering behavior for start tab, file tabs, and fallback naming.
  describe('Rendering', () => {
    it('should render start tab and tabs for regular and artifact files', () => {
      const artifactTabId = makeArtifactTabId('/assets/logo.png')
      setMockState({
        openTabIds: ['file-1', artifactTabId],
        activeTabId: 'file-1',
      })
      setMockNodeMap([
        createNode({ id: 'file-1', name: 'guide.md' }),
      ])

      render(<FileTabs />)

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.startTab/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /guide\.md/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /logo\.png/i })).toBeInTheDocument()
    })

    it('should fall back to file id when node is missing from node map', () => {
      setMockState({
        openTabIds: ['missing-file-id'],
        activeTabId: 'missing-file-id',
      })
      setMockNodeMap([])

      render(<FileTabs />)

      expect(screen.getByRole('button', { name: /missing-file-id/i })).toBeInTheDocument()
    })
  })

  // Tab interactions should dispatch store actions.
  describe('Tab actions', () => {
    it('should activate the start tab when start tab is clicked', () => {
      render(<FileTabs />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.startTab/i }))

      expect(mocks.activateTab).toHaveBeenCalledTimes(1)
      expect(mocks.activateTab).toHaveBeenCalledWith(START_TAB_ID)
    })

    it('should activate a file tab when a file tab is clicked', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: START_TAB_ID,
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)
      fireEvent.click(screen.getByRole('button', { name: /guide\.md/i }))

      expect(mocks.activateTab).toHaveBeenCalledTimes(1)
      expect(mocks.activateTab).toHaveBeenCalledWith('file-1')
    })

    it('should pin a preview tab when it is double clicked', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: 'file-1',
        previewTabId: 'file-1',
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)
      fireEvent.doubleClick(screen.getByRole('button', { name: /guide\.md/i }))

      expect(mocks.pinTab).toHaveBeenCalledTimes(1)
      expect(mocks.pinTab).toHaveBeenCalledWith('file-1')
    })

    it('should close a clean file tab and clear draft and metadata', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: 'file-1',
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))

      expect(mocks.closeTab).toHaveBeenCalledTimes(1)
      expect(mocks.closeTab).toHaveBeenCalledWith('file-1')
      expect(mocks.clearDraftContent).toHaveBeenCalledWith('file-1')
      expect(mocks.clearFileMetadata).toHaveBeenCalledWith('file-1')
      expect(mocks.clearArtifactSelection).not.toHaveBeenCalled()
    })

    it('should clear artifact selection before closing artifact tab', () => {
      const artifactTabId = makeArtifactTabId('/assets/logo.png')
      setMockState({
        openTabIds: [artifactTabId],
        activeTabId: artifactTabId,
      })

      render(<FileTabs />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))

      expect(mocks.clearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mocks.closeTab).toHaveBeenCalledWith(artifactTabId)
      expect(mocks.clearDraftContent).toHaveBeenCalledWith(artifactTabId)
      expect(mocks.clearFileMetadata).toHaveBeenCalledWith(artifactTabId)
    })
  })

  // Dirty tabs must show confirmation before closing.
  describe('Unsaved changes confirmation', () => {
    it('should show confirmation dialog instead of closing immediately for dirty tab', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: 'file-1',
        dirtyContents: new Set(['file-1']),
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))

      expect(mocks.closeTab).not.toHaveBeenCalled()
      expect(screen.getByText('workflow.skillSidebar.unsavedChanges.title')).toBeInTheDocument()
    })

    it('should close the dirty tab when user confirms', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: 'file-1',
        dirtyMetadataIds: new Set(['file-1']),
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.unsavedChanges\.confirmClose/i }))

      expect(mocks.closeTab).toHaveBeenCalledTimes(1)
      expect(mocks.closeTab).toHaveBeenCalledWith('file-1')
      expect(mocks.clearDraftContent).toHaveBeenCalledWith('file-1')
      expect(mocks.clearFileMetadata).toHaveBeenCalledWith('file-1')
    })

    it('should keep the tab open when user cancels the close confirmation', () => {
      setMockState({
        openTabIds: ['file-1'],
        activeTabId: 'file-1',
        dirtyContents: new Set(['file-1']),
      })
      setMockNodeMap([createNode({ id: 'file-1', name: 'guide.md' })])

      render(<FileTabs />)

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(mocks.closeTab).not.toHaveBeenCalled()
      expect(mocks.clearDraftContent).not.toHaveBeenCalled()
      expect(mocks.clearFileMetadata).not.toHaveBeenCalled()
    })
  })
})
