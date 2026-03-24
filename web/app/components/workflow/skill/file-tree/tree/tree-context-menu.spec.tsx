import { fireEvent, render, screen } from '@testing-library/react'
import { ROOT_ID } from '../../constants'
import TreeContextMenu from './tree-context-menu'

const mocks = vi.hoisted(() => ({
  clearSelection: vi.fn(),
  setSelectedNodeIds: vi.fn(),
  deselectAll: vi.fn(),
  getNode: vi.fn(),
  selectNode: vi.fn(),
  useFileOperations: vi.fn(),
  fileOperations: {
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
    handleDeleteConfirm: vi.fn(),
    handleDeleteCancel: vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      clearSelection: mocks.clearSelection,
      setSelectedNodeIds: mocks.setSelectedNodeIds,
    }),
  }),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockImportSkillModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
      if (!isOpen)
        return null

      return (
        <div data-testid="import-skill-modal">
          <button type="button" onClick={onClose}>
            close-import-modal
          </button>
        </div>
      )
    }

    return MockImportSkillModal
  },
}))

vi.mock('../../hooks/file-tree/operations/use-file-operations', () => ({
  useFileOperations: (...args: unknown[]) => {
    mocks.useFileOperations(...args)
    return mocks.fileOperations
  },
}))

vi.mock('./node-menu', () => ({
  default: ({ type, menuType, nodeId, onImportSkills }: { type: string, menuType: string, nodeId?: string, onImportSkills?: () => void }) => (
    <div
      data-testid={`node-menu-${menuType}`}
      data-type={type}
      data-node-id={nodeId ?? ''}
    >
      {onImportSkills && (
        <button type="button" onClick={onImportSkills}>
          open-import-skill-modal
        </button>
      )}
    </div>
  ),
}))

describe('TreeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fileOperations.showDeleteConfirm = false
  })

  describe('Rendering', () => {
    it('should render trigger children', () => {
      render(
        <TreeContextMenu treeRef={{ current: null }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      expect(screen.getByText('blank area')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should clear selection and open root menu when blank area is right clicked', () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll, get: mocks.getNode } as never }}>
          <div>
            <div data-skill-tree-node-id="file-1" data-skill-tree-node-type="file" role="treeitem">
              readme.md
            </div>
            <div>blank area</div>
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('blank area'))

      expect(mocks.deselectAll).toHaveBeenCalledTimes(1)
      expect(mocks.clearSelection).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-type', 'root')
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-node-id', ROOT_ID)
    })

    it('should switch to item menu when a tree node is right clicked', () => {
      mocks.getNode.mockReturnValue({
        select: mocks.selectNode,
        data: { name: 'readme.md' },
      })

      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll, get: mocks.getNode } as never }}>
          <div>
            <div data-skill-tree-node-id="file-1" data-skill-tree-node-type="file" role="treeitem">
              readme.md
            </div>
            <div>blank area</div>
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByRole('treeitem'))

      expect(mocks.getNode).toHaveBeenCalledWith('file-1')
      expect(mocks.deselectAll).toHaveBeenCalledTimes(1)
      expect(mocks.selectNode).toHaveBeenCalledTimes(1)
      expect(mocks.setSelectedNodeIds).toHaveBeenCalledWith(['file-1'])
      expect(mocks.clearSelection).not.toHaveBeenCalled()
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-type', 'file')
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-node-id', 'file-1')
      expect(mocks.useFileOperations).toHaveBeenLastCalledWith(expect.objectContaining({
        nodeId: 'file-1',
        nodeType: 'file',
        fileName: 'readme.md',
      }))
    })

    it('should keep import modal mounted after root menu requests it', () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll } as never }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('blank area'))
      fireEvent.click(screen.getByRole('button', { name: /open-import-skill-modal/i }))

      expect(screen.getByTestId('import-skill-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByText(/close-import-modal/i))
      expect(screen.queryByTestId('import-skill-modal')).not.toBeInTheDocument()
    })

    it('should keep delete confirmation dialog mounted for item context actions', () => {
      mocks.fileOperations.showDeleteConfirm = true

      render(
        <TreeContextMenu treeRef={{ current: { get: mocks.getNode } as never }}>
          <div data-skill-tree-node-id="file-1" data-skill-tree-node-type="file" role="treeitem">
            readme.md
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByRole('treeitem'))

      expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmContent')).toBeInTheDocument()
    })
  })
})
