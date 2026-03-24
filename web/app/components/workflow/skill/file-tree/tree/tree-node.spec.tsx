import type { NodeApi, NodeRendererProps, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import { fireEvent, render, screen } from '@testing-library/react'
import TreeNode from './tree-node'

type MockWorkflowSelectorState = {
  dirtyContents: Set<string>
  isCutNode: (nodeId: string) => boolean
}

type NodeState = {
  id: string
  nodeType: 'file' | 'folder'
  name: string
  extension: string
  isSelected: boolean
  isOpen: boolean
  isDragging: boolean
  willReceiveDrop: boolean
  isEditing: boolean
  level: number
}

const workflowState = vi.hoisted(() => ({
  dirtyContents: new Set<string>(),
  cutNodeIds: new Set<string>(),
  dragOverFolderId: null as string | null,
}))

const storeActions = vi.hoisted(() => ({
  setCurrentDragType: vi.fn(),
  setDragOverFolderId: vi.fn(),
}))

const handlerMocks = vi.hoisted(() => ({
  handleClick: vi.fn(),
  handleDoubleClick: vi.fn(),
  handleToggle: vi.fn(),
  handleKeyDown: vi.fn(),
}))

const dndMocks = vi.hoisted(() => ({
  isDragOver: false,
  isBlinking: false,
  onDragEnter: vi.fn(),
  onDragOver: vi.fn(),
  onDrop: vi.fn(),
  onDragLeave: vi.fn(),
}))

const fileOperationMocks = vi.hoisted(() => ({
  fileInputRef: { current: null },
  folderInputRef: { current: null },
  showDeleteConfirm: false,
  isLoading: false,
  isDeleting: false,
  handleDownload: vi.fn(),
  handleNewFile: vi.fn(),
  handleNewFolder: vi.fn(),
  handleFileChange: vi.fn(),
  handleFolderChange: vi.fn(),
  handleRename: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleDeleteConfirm: vi.fn(async () => undefined),
  handleDeleteCancel: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowSelectorState) => unknown) => selector({
    dirtyContents: workflowState.dirtyContents,
    isCutNode: (nodeId: string) => workflowState.cutNodeIds.has(nodeId),
  }),
  useWorkflowStore: () => ({
    getState: () => ({
      dragOverFolderId: workflowState.dragOverFolderId,
      setCurrentDragType: (type: 'move' | null) => {
        storeActions.setCurrentDragType(type)
      },
      setDragOverFolderId: (folderId: string | null) => {
        workflowState.dragOverFolderId = folderId
        storeActions.setDragOverFolderId(folderId)
      },
    }),
  }),
}))

vi.mock('../../hooks/file-tree/interaction/use-tree-node-handlers', () => ({
  useTreeNodeHandlers: () => ({
    handleClick: handlerMocks.handleClick,
    handleDoubleClick: handlerMocks.handleDoubleClick,
    handleToggle: handlerMocks.handleToggle,
    handleKeyDown: handlerMocks.handleKeyDown,
  }),
}))

vi.mock('../../hooks/file-tree/dnd/use-folder-file-drop', () => ({
  useFolderFileDrop: () => ({
    isDragOver: dndMocks.isDragOver,
    isBlinking: dndMocks.isBlinking,
    dragHandlers: {
      onDragEnter: dndMocks.onDragEnter,
      onDragOver: dndMocks.onDragOver,
      onDrop: dndMocks.onDrop,
      onDragLeave: dndMocks.onDragLeave,
    },
  }),
}))

vi.mock('../../hooks/file-tree/operations/use-file-operations', () => ({
  useFileOperations: () => fileOperationMocks,
}))

vi.mock('./node-menu', () => ({
  default: ({ type, menuType, onClose }: { type: string, menuType: string, onClose: () => void }) => (
    <div data-testid={`node-menu-${menuType}`} data-type={type}>
      <button type="button" onClick={onClose}>close-menu</button>
    </div>
  ),
}))

const createNode = (overrides: Partial<NodeState> = {}): NodeApi<TreeNodeData> => {
  const resolved: NodeState = {
    id: overrides.id ?? 'file-1',
    nodeType: overrides.nodeType ?? 'file',
    name: overrides.name ?? 'readme.md',
    extension: overrides.extension ?? 'md',
    isSelected: overrides.isSelected ?? false,
    isOpen: overrides.isOpen ?? false,
    isDragging: overrides.isDragging ?? false,
    willReceiveDrop: overrides.willReceiveDrop ?? false,
    isEditing: overrides.isEditing ?? false,
    level: overrides.level ?? 0,
  }

  return {
    data: {
      id: resolved.id,
      node_type: resolved.nodeType,
      name: resolved.name,
      path: `/${resolved.name}`,
      extension: resolved.nodeType === 'folder' ? '' : resolved.extension,
      size: 0,
      children: [],
    },
    isSelected: resolved.isSelected,
    isOpen: resolved.isOpen,
    isDragging: resolved.isDragging,
    willReceiveDrop: resolved.willReceiveDrop,
    isEditing: resolved.isEditing,
    level: resolved.level,
    select: vi.fn(),
  } as unknown as NodeApi<TreeNodeData>
}

const buildProps = (nodeOverrides: Partial<NodeState> = {}): NodeRendererProps<TreeNodeData> & {
  treeChildren: TreeNodeData[]
} => ({
  node: createNode(nodeOverrides),
  style: {},
  tree: {} as TreeApi<TreeNodeData>,
  dragHandle: vi.fn(),
  treeChildren: [],
})

describe('TreeNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    workflowState.dirtyContents.clear()
    workflowState.cutNodeIds.clear()
    workflowState.dragOverFolderId = null

    dndMocks.isDragOver = false
    dndMocks.isBlinking = false
    fileOperationMocks.showDeleteConfirm = false
    fileOperationMocks.isDeleting = false
  })

  // Core rendering should reflect selection, folder expansion, and store-driven visual states.
  describe('Rendering', () => {
    it('should render file node with action button label', () => {
      const props = buildProps({ id: 'file-1', name: 'readme.md', nodeType: 'file' })

      render(<TreeNode {...props} />)

      const treeItem = screen.getByRole('treeitem')
      expect(treeItem).toHaveAttribute('aria-selected', 'false')
      expect(treeItem).not.toHaveAttribute('aria-expanded')
      expect(screen.getByText('readme.md')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.moreActions/i })).toBeInTheDocument()
    })

    it('should render selected open folder with folder expansion aria state', () => {
      const props = buildProps({
        id: 'folder-1',
        name: 'src',
        nodeType: 'folder',
        isSelected: true,
        isOpen: true,
      })

      render(<TreeNode {...props} />)

      const treeItem = screen.getByRole('treeitem')
      expect(treeItem).toHaveAttribute('aria-selected', 'true')
      expect(treeItem).toHaveAttribute('aria-expanded', 'true')
      expect(treeItem).toHaveClass('bg-state-base-active')
    })

    it('should apply drag-over, blinking, and cut styles when states are active', () => {
      dndMocks.isDragOver = true
      dndMocks.isBlinking = true
      workflowState.cutNodeIds.add('folder-1')
      const props = buildProps({
        id: 'folder-1',
        nodeType: 'folder',
        name: 'src',
      })

      render(<TreeNode {...props} />)

      const treeItem = screen.getByRole('treeitem')
      expect(treeItem).toHaveClass('ring-state-accent-solid')
      expect(treeItem).toHaveClass('animate-drag-blink')
      expect(treeItem).toHaveClass('opacity-50')
    })
  })

  // User interactions on the node surface should forward to handler hooks and DnD hooks.
  describe('Event wiring', () => {
    it('should call click and double-click handlers from main content interactions', () => {
      const props = buildProps({ id: 'file-1', name: 'readme.md', nodeType: 'file' })

      render(<TreeNode {...props} />)

      const label = screen.getByText('readme.md')
      fireEvent.click(label)
      fireEvent.doubleClick(label)

      expect(handlerMocks.handleClick).toHaveBeenCalled()
      expect(handlerMocks.handleDoubleClick).toHaveBeenCalled()
    })

    it('should call keyboard handler and expose node metadata for the shared context menu host', () => {
      const props = buildProps({ id: 'file-1', name: 'readme.md', nodeType: 'file' })

      render(<TreeNode {...props} />)

      const treeItem = screen.getByRole('treeitem')
      fireEvent.keyDown(treeItem, { key: 'Enter' })

      expect(handlerMocks.handleKeyDown).toHaveBeenCalledTimes(1)
      expect(treeItem).toHaveAttribute('data-skill-tree-node-id', 'file-1')
      expect(treeItem).toHaveAttribute('data-skill-tree-node-type', 'file')
    })

    it('should attach folder drag handlers only when node is a folder', () => {
      const folderProps = buildProps({ id: 'folder-1', name: 'src', nodeType: 'folder' })
      const { rerender } = render(<TreeNode {...folderProps} />)

      const folderTreeItem = screen.getByRole('treeitem')
      fireEvent.dragEnter(folderTreeItem)
      fireEvent.dragOver(folderTreeItem)
      fireEvent.drop(folderTreeItem)
      fireEvent.dragLeave(folderTreeItem)

      expect(dndMocks.onDragEnter).toHaveBeenCalledTimes(1)
      expect(dndMocks.onDragOver).toHaveBeenCalledTimes(1)
      expect(dndMocks.onDrop).toHaveBeenCalledTimes(1)
      expect(dndMocks.onDragLeave).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()

      const fileProps = buildProps({ id: 'file-2', name: 'guide.md', nodeType: 'file' })
      rerender(<TreeNode {...fileProps} />)

      const fileTreeItem = screen.getByRole('treeitem')
      fireEvent.dragEnter(fileTreeItem)
      fireEvent.dragOver(fileTreeItem)
      fireEvent.drop(fileTreeItem)
      fireEvent.dragLeave(fileTreeItem)

      expect(dndMocks.onDragEnter).not.toHaveBeenCalled()
      expect(dndMocks.onDragOver).not.toHaveBeenCalled()
      expect(dndMocks.onDrop).not.toHaveBeenCalled()
      expect(dndMocks.onDragLeave).not.toHaveBeenCalled()
    })

    it('should open dropdown menu when more actions button is clicked', () => {
      const props = buildProps({ id: 'file-1', name: 'readme.md', nodeType: 'file' })

      render(<TreeNode {...props} />)

      expect(screen.queryByTestId('node-menu-dropdown')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.moreActions/i }))

      expect(screen.getByTestId('node-menu-dropdown')).toHaveAttribute('data-type', 'file')
    })
  })

  // Effects should synchronize external drag status transitions into workflow store state.
  describe('Drag state synchronization effects', () => {
    it('should set drag type on drag start and clear drag state on drag end', () => {
      const initialProps = buildProps({ id: 'file-1', nodeType: 'file', isDragging: false })
      const { rerender } = render(<TreeNode {...initialProps} />)

      const draggingProps = buildProps({ id: 'file-1', nodeType: 'file', isDragging: true })
      rerender(<TreeNode {...draggingProps} />)

      expect(storeActions.setCurrentDragType).toHaveBeenCalledWith('move')

      const notDraggingProps = buildProps({ id: 'file-1', nodeType: 'file', isDragging: false })
      rerender(<TreeNode {...notDraggingProps} />)

      expect(storeActions.setCurrentDragType).toHaveBeenCalledWith(null)
      expect(storeActions.setDragOverFolderId).toHaveBeenCalledWith(null)
    })

    it('should sync drag-over folder id when folder willReceiveDrop changes', () => {
      const initialProps = buildProps({
        id: 'folder-1',
        nodeType: 'folder',
        willReceiveDrop: false,
      })
      const { rerender } = render(<TreeNode {...initialProps} />)

      const receiveDropProps = buildProps({
        id: 'folder-1',
        nodeType: 'folder',
        willReceiveDrop: true,
      })
      rerender(<TreeNode {...receiveDropProps} />)

      expect(storeActions.setDragOverFolderId).toHaveBeenCalledWith('folder-1')

      const stopReceiveDropProps = buildProps({
        id: 'folder-1',
        nodeType: 'folder',
        willReceiveDrop: false,
      })
      rerender(<TreeNode {...stopReceiveDropProps} />)

      expect(storeActions.setDragOverFolderId).toHaveBeenCalledWith(null)
    })
  })
})
