import type { ReactNode, Ref } from 'react'
import type { AppAssetTreeView } from '@/types/app-asset'
import { fireEvent, render, screen } from '@testing-library/react'
import { CONTEXT_MENU_TYPE, ROOT_ID } from '../../constants'
import FileTree from './file-tree'

type MockWorkflowState = {
  expandedFolderIds: Set<string>
  activeTabId: string | null
  dragOverFolderId: string | null
  currentDragType: 'move' | 'upload' | null
  fileTreeSearchTerm: string
}

type MockWorkflowActions = {
  toggleFolder: (id: string) => void
  openTab: (id: string, options: { pinned: boolean }) => void
  setSelectedNodeIds: (ids: string[]) => void
  clearSelection: () => void
  setContextMenu: (menu: { top: number, left: number, type: string } | null) => void
  setDragInsertTarget: (target: { parentId: string | null, index: number } | null) => void
  setFileTreeSearchTerm: (term: string) => void
}

type MockAssetTreeHookResult = {
  data: { children: AppAssetTreeView[] } | undefined
  isLoading: boolean
  error: Error | null
  dataUpdatedAt: number
}

type MockInlineCreateNodeResult = {
  treeNodes: AppAssetTreeView[]
  handleRename: (payload: { id: string, name: string }) => void
  searchMatch: (node: { data: { name: string } }, term: string) => boolean
  hasPendingCreate: boolean
}

type MockTreeApi = {
  deselectAll: () => void
  state: {
    nodes: {
      drag: {
        id: string | null
        destinationParentId: string | null
        destinationIndex: number | null
      }
    }
  }
  store: {
    subscribe: (listener: () => void) => () => void
  }
  root: {
    id: string
    children: Array<{ id: string }>
  }
  dragDestinationIndex: number | null | undefined
}

type CapturedTreeProps = {
  onToggle: (id: string) => void
  onSelect: (nodes: Array<{ id: string }>) => void
  onActivate: (node: { data: { id: string, node_type: 'file' | 'folder' }, toggle: () => void }) => void
  onMove: (args: {
    dragIds: string[]
    parentId: string | null
    index: number
    dragNodes: Array<{ id: string, data: { node_type: 'file' | 'folder' }, parent: { id: string, isRoot?: boolean } | null }>
    parentNode: { id: string, children: Array<{ id: string }> } | undefined
  }) => void
  disableDrop: (args: {
    parentNode: { id: string, data: { node_type: 'file' | 'folder' }, children: Array<{ id: string }> }
    dragNodes: Array<{ id: string, data: { node_type: 'file' | 'folder' } }>
    index: number
  }) => boolean
}

function createNode(overrides: Partial<AppAssetTreeView> = {}): AppAssetTreeView {
  return {
    id: overrides.id ?? 'file-1',
    node_type: overrides.node_type ?? 'file',
    name: overrides.name ?? 'guide.md',
    path: overrides.path ?? '/guide.md',
    extension: overrides.extension ?? 'md',
    size: overrides.size ?? 1,
    children: overrides.children ?? [],
  }
}

function createTreeApiMock(): MockTreeApi {
  return {
    deselectAll: vi.fn(),
    state: {
      nodes: {
        drag: {
          id: null,
          destinationParentId: null,
          destinationIndex: null,
        },
      },
    },
    store: {
      subscribe: vi.fn(() => vi.fn()),
    },
    root: {
      id: 'root',
      children: [],
    },
    dragDestinationIndex: null,
  }
}

function createRootDropHandlersMock() {
  return {
    handleRootDragEnter: vi.fn(),
    handleRootDragLeave: vi.fn(),
    handleRootDragOver: vi.fn(),
    handleRootDrop: vi.fn(),
    resetRootDragCounter: vi.fn(),
  }
}

function createInlineCreateNodeMock(): MockInlineCreateNodeResult {
  return {
    treeNodes: [createNode()],
    handleRename: vi.fn(),
    searchMatch: vi.fn(() => true),
    hasPendingCreate: false,
  }
}

const mocks = vi.hoisted(() => ({
  storeState: {
    expandedFolderIds: new Set<string>(),
    activeTabId: null,
    dragOverFolderId: null,
    currentDragType: null,
    fileTreeSearchTerm: '',
  } as MockWorkflowState,
  actions: {
    toggleFolder: vi.fn(),
    openTab: vi.fn(),
    setSelectedNodeIds: vi.fn(),
    clearSelection: vi.fn(),
    setContextMenu: vi.fn(),
    setDragInsertTarget: vi.fn(),
    setFileTreeSearchTerm: vi.fn(),
  } as MockWorkflowActions,
  skillAssetTreeData: {
    data: { children: [createNode()] },
    isLoading: false,
    error: null,
    dataUpdatedAt: 1,
  } as MockAssetTreeHookResult,
  inlineCreateNode: createInlineCreateNodeMock(),
  rootDropHandlers: createRootDropHandlersMock(),
  executeMoveNode: vi.fn(),
  executeReorderNode: vi.fn(),
  useSkillTreeCollaboration: vi.fn(),
  useSkillShortcuts: vi.fn(),
  useSyncTreeWithActiveTab: vi.fn(),
  usePasteOperation: vi.fn(),
  treeApi: createTreeApiMock(),
  treeProps: null as CapturedTreeProps | null,
  isMutating: 0,
  containerSize: { height: 320 } as { height: number } | undefined,
  isDescendantOf: vi.fn<(parentId: string, nodeId: string, treeChildren: AppAssetTreeView[]) => boolean>(() => false),
}))

vi.mock('react-arborist', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  type MockTreeComponentProps = {
    children?: ReactNode
  } & Record<string, unknown>

  const Tree = React.forwardRef((props: MockTreeComponentProps, ref: Ref<unknown>) => {
    mocks.treeProps = props as unknown as CapturedTreeProps

    if (typeof ref === 'function')
      ref(mocks.treeApi)
    else if (ref)
      (ref as { current: unknown }).current = mocks.treeApi

    return <div data-testid="arborist-tree" />
  })

  return { Tree }
})

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useIsMutating: () => mocks.isMutating,
  }
})

vi.mock('ahooks', () => ({
  useSize: () => mocks.containerSize,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => mocks.actions,
  }),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetTreeData: () => mocks.skillAssetTreeData,
}))

vi.mock('../../hooks/file-tree/data/use-skill-tree-collaboration', () => ({
  useSkillTreeCollaboration: () => mocks.useSkillTreeCollaboration(),
}))

vi.mock('../../hooks/file-tree/dnd/use-root-file-drop', () => ({
  useRootFileDrop: () => mocks.rootDropHandlers,
}))

vi.mock('../../hooks/file-tree/interaction/use-inline-create-node', () => ({
  useInlineCreateNode: () => mocks.inlineCreateNode,
}))

vi.mock('../../hooks/file-tree/interaction/use-skill-shortcuts', () => ({
  useSkillShortcuts: (args: unknown) => mocks.useSkillShortcuts(args),
}))

vi.mock('../../hooks/file-tree/interaction/use-sync-tree-with-active-tab', () => ({
  useSyncTreeWithActiveTab: (args: unknown) => mocks.useSyncTreeWithActiveTab(args),
}))

vi.mock('../../hooks/file-tree/operations/use-node-move', () => ({
  useNodeMove: () => ({ executeMoveNode: mocks.executeMoveNode }),
}))

vi.mock('../../hooks/file-tree/operations/use-node-reorder', () => ({
  useNodeReorder: () => ({ executeReorderNode: mocks.executeReorderNode }),
}))

vi.mock('../../hooks/file-tree/operations/use-paste-operation', () => ({
  usePasteOperation: (args: unknown) => mocks.usePasteOperation(args),
}))

vi.mock('../../utils/tree-utils', () => ({
  isDescendantOf: (parentId: string, nodeId: string, treeChildren: AppAssetTreeView[]) =>
    mocks.isDescendantOf(parentId, nodeId, treeChildren),
}))

vi.mock('./search-result-list', () => ({
  default: ({ searchTerm }: { searchTerm: string }) => (
    <div data-testid="search-result-list">{searchTerm}</div>
  ),
}))

vi.mock('./drag-action-tooltip', () => ({
  default: ({ action }: { action: string }) => (
    <div data-testid="drag-action-tooltip">{action}</div>
  ),
}))

vi.mock('./upload-status-tooltip', () => ({
  default: ({ fallback }: { fallback?: ReactNode }) => (
    <div data-testid="upload-status-tooltip">{fallback}</div>
  ),
}))

vi.mock('./tree-context-menu', () => ({
  default: () => <div data-testid="tree-context-menu" />,
}))

function getCapturedTreeProps(): CapturedTreeProps {
  if (!mocks.treeProps)
    throw new Error('Tree props were not captured')
  return mocks.treeProps
}

function getTreeDropZone(): HTMLElement {
  const tree = screen.getByTestId('arborist-tree')
  const dropZone = tree.parentElement
  if (!dropZone)
    throw new Error('Tree drop zone not found')
  return dropZone
}

function resetMockState() {
  mocks.storeState.expandedFolderIds = new Set<string>()
  mocks.storeState.activeTabId = null
  mocks.storeState.dragOverFolderId = null
  mocks.storeState.currentDragType = null
  mocks.storeState.fileTreeSearchTerm = ''

  mocks.skillAssetTreeData = {
    data: { children: [createNode()] },
    isLoading: false,
    error: null,
    dataUpdatedAt: 1,
  }

  mocks.inlineCreateNode = createInlineCreateNodeMock()
  mocks.rootDropHandlers = createRootDropHandlersMock()
  mocks.executeMoveNode = vi.fn()
  mocks.executeReorderNode = vi.fn()
  mocks.treeApi = createTreeApiMock()
  mocks.treeProps = null
  mocks.isMutating = 0
  mocks.containerSize = { height: 320 }
  mocks.isDescendantOf = vi.fn(() => false)
}

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockState()
  })

  describe('Tree states', () => {
    it('should render loading state when tree data is loading', () => {
      mocks.skillAssetTreeData.isLoading = true
      mocks.skillAssetTreeData.data = undefined

      render(<FileTree />)

      expect(screen.getByRole('status', { name: /appApi\.loading/i })).toBeInTheDocument()
    })

    it('should render error state when tree query fails', () => {
      mocks.skillAssetTreeData.error = new Error('request failed')

      render(<FileTree />)

      expect(screen.getByText('workflow.skillSidebar.loadError')).toBeInTheDocument()
    })

    it('should render empty state and root drop tip when tree has no children', () => {
      mocks.skillAssetTreeData.data = { children: [] }
      mocks.inlineCreateNode.treeNodes = []

      render(<FileTree />)

      expect(screen.getByText('workflow.skillSidebar.empty')).toBeInTheDocument()
      expect(screen.getByText('workflow.skillSidebar.dropTip')).toBeInTheDocument()
    })

    it('should render search no result state and reset filter action', () => {
      mocks.storeState.fileTreeSearchTerm = 'missing-keyword'
      mocks.skillAssetTreeData.data = {
        children: [createNode({ name: 'existing.txt', extension: 'txt', path: '/existing.txt' })],
      }
      mocks.inlineCreateNode.treeNodes = mocks.skillAssetTreeData.data.children

      render(<FileTree />)

      expect(screen.getByText('workflow.skillSidebar.searchNoResults')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.resetFilter/i }))

      expect(mocks.actions.setFileTreeSearchTerm).toHaveBeenCalledWith('')
    })

    it('should render search result list when search term has matches', () => {
      mocks.storeState.fileTreeSearchTerm = 'guide'
      mocks.skillAssetTreeData.data = {
        children: [createNode({ name: 'guide.md' })],
      }
      mocks.inlineCreateNode.treeNodes = mocks.skillAssetTreeData.data.children

      render(<FileTree />)

      expect(screen.getByTestId('search-result-list')).toHaveTextContent('guide')
      expect(screen.queryByTestId('arborist-tree')).not.toBeInTheDocument()
    })

    it('should render normal tree view with root drag highlight and drag action tooltip', () => {
      mocks.storeState.dragOverFolderId = ROOT_ID
      mocks.storeState.currentDragType = 'move'
      mocks.isMutating = 1

      render(<FileTree />)

      const treeContainer = document.querySelector('[data-skill-tree-container]')
      expect(treeContainer).toHaveClass('pointer-events-none')

      const dropZone = getTreeDropZone()
      expect(dropZone).toHaveClass('bg-state-accent-hover')
      expect(screen.getByTestId('drag-action-tooltip')).toHaveTextContent('move')
      expect(screen.queryByTestId('upload-status-tooltip')).not.toBeInTheDocument()
      expect(screen.getByTestId('tree-context-menu')).toBeInTheDocument()
    })
  })

  describe('Container interactions', () => {
    it('should deselect tree and clear store selection when blank area is clicked', () => {
      render(<FileTree />)

      fireEvent.click(getTreeDropZone())

      expect(mocks.treeApi.deselectAll).toHaveBeenCalledTimes(1)
      expect(mocks.actions.clearSelection).toHaveBeenCalledTimes(1)
    })

    it('should open blank context menu with pointer position on right click', () => {
      render(<FileTree />)

      fireEvent.contextMenu(getTreeDropZone(), { clientX: 64, clientY: 128 })

      expect(mocks.treeApi.deselectAll).toHaveBeenCalledTimes(1)
      expect(mocks.actions.clearSelection).toHaveBeenCalledTimes(1)
      expect(mocks.actions.setContextMenu).toHaveBeenCalledWith({
        top: 128,
        left: 64,
        type: CONTEXT_MENU_TYPE.BLANK,
      })
    })

    it('should forward root drag events to root file drop handlers', () => {
      render(<FileTree />)

      const dropZone = getTreeDropZone()
      fireEvent.dragEnter(dropZone)
      fireEvent.dragOver(dropZone)
      fireEvent.dragLeave(dropZone)
      fireEvent.drop(dropZone)

      expect(mocks.rootDropHandlers.handleRootDragEnter).toHaveBeenCalledTimes(1)
      expect(mocks.rootDropHandlers.handleRootDragOver).toHaveBeenCalledTimes(1)
      expect(mocks.rootDropHandlers.handleRootDragLeave).toHaveBeenCalledTimes(1)
      expect(mocks.rootDropHandlers.handleRootDrop).toHaveBeenCalledTimes(1)
    })
  })

  describe('Tree callbacks', () => {
    it('should open file tab when file node is activated and toggle folder node', () => {
      render(<FileTree />)
      const treeProps = getCapturedTreeProps()

      const folderToggle = vi.fn()
      treeProps.onActivate({
        data: { id: 'file-9', node_type: 'file' },
        toggle: vi.fn(),
      })
      treeProps.onActivate({
        data: { id: 'folder-9', node_type: 'folder' },
        toggle: folderToggle,
      })

      expect(mocks.actions.openTab).toHaveBeenCalledWith('file-9', { pinned: true })
      expect(folderToggle).toHaveBeenCalledTimes(1)
    })

    it('should update expanded and selected ids from tree callbacks', () => {
      render(<FileTree />)
      const treeProps = getCapturedTreeProps()

      treeProps.onToggle('folder-1')
      treeProps.onSelect([{ id: 'file-1' }, { id: 'file-2' }])

      expect(mocks.actions.toggleFolder).toHaveBeenCalledWith('folder-1')
      expect(mocks.actions.setSelectedNodeIds).toHaveBeenCalledWith(['file-1', 'file-2'])
    })

    it('should disable drop for invalid targets and allow valid folder drops', () => {
      render(<FileTree />)
      const treeProps = getCapturedTreeProps()

      const dropToFile = treeProps.disableDrop({
        parentNode: { id: 'file-parent', data: { node_type: 'file' }, children: [] },
        dragNodes: [{ id: 'drag-1', data: { node_type: 'file' } }],
        index: 0,
      })
      const dropToSelf = treeProps.disableDrop({
        parentNode: { id: 'folder-self', data: { node_type: 'folder' }, children: [] },
        dragNodes: [{ id: 'folder-self', data: { node_type: 'folder' } }],
        index: 0,
      })

      mocks.isDescendantOf = vi.fn(() => true)
      const circularDrop = treeProps.disableDrop({
        parentNode: { id: 'folder-child', data: { node_type: 'folder' }, children: [] },
        dragNodes: [{ id: 'folder-parent', data: { node_type: 'folder' } }],
        index: 0,
      })

      mocks.isDescendantOf = vi.fn(() => false)
      const validDrop = treeProps.disableDrop({
        parentNode: { id: 'folder-target', data: { node_type: 'folder' }, children: [] },
        dragNodes: [{ id: 'file-3', data: { node_type: 'file' } }],
        index: 0,
      })

      expect(dropToFile).toBe(true)
      expect(dropToSelf).toBe(true)
      expect(circularDrop).toBe(true)
      expect(validDrop).toBe(false)
    })

    it('should reorder node when drag is insert-line within same parent', () => {
      mocks.treeApi.dragDestinationIndex = 2
      render(<FileTree />)
      const treeProps = getCapturedTreeProps()

      treeProps.onMove({
        dragIds: ['file-b'],
        parentId: 'folder-1',
        index: 2,
        dragNodes: [{
          id: 'file-b',
          data: { node_type: 'file' },
          parent: { id: 'folder-1', isRoot: false },
        }],
        parentNode: {
          id: 'folder-1',
          children: [{ id: 'file-a' }, { id: 'file-b' }, { id: 'file-c' }],
        },
      })

      expect(mocks.executeReorderNode).toHaveBeenCalledWith('file-b', 'file-a')
      expect(mocks.executeMoveNode).not.toHaveBeenCalled()
    })

    it('should move node when destination parent differs or insert line is absent', () => {
      mocks.treeApi.dragDestinationIndex = null
      render(<FileTree />)
      const treeProps = getCapturedTreeProps()

      treeProps.onMove({
        dragIds: ['file-1'],
        parentId: 'folder-2',
        index: 0,
        dragNodes: [{
          id: 'file-1',
          data: { node_type: 'file' },
          parent: { id: 'folder-1', isRoot: false },
        }],
        parentNode: {
          id: 'folder-2',
          children: [{ id: 'file-4' }],
        },
      })

      expect(mocks.executeMoveNode).toHaveBeenCalledWith('file-1', 'folder-2')
      expect(mocks.executeReorderNode).not.toHaveBeenCalled()
    })
  })
})
