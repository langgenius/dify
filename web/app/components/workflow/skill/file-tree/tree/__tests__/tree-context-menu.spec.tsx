import { fireEvent, render, screen } from '@testing-library/react'
import { ROOT_ID } from '../../../constants'
import TreeContextMenu from '.././tree-context-menu'

const mocks = vi.hoisted(() => ({
  selectedNodeIds: new Set<string>(),
  clearSelection: vi.fn(),
  setSelectedNodeIds: vi.fn(),
  deselectAll: vi.fn(),
  getNode: vi.fn(),
  selectNode: vi.fn(),
  useFileOperations: vi.fn(),
  dynamicImporters: [] as Array<() => Promise<unknown>>,
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
      selectedNodeIds: mocks.selectedNodeIds,
      clearSelection: mocks.clearSelection,
      setSelectedNodeIds: mocks.setSelectedNodeIds,
    }),
  }),
}))

vi.mock('@/next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    mocks.dynamicImporters.push(loader)
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

vi.mock('../../start-tab/import-skill-modal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen)
      return null

    return (
      <div data-testid="resolved-import-skill-modal">
        <button type="button" onClick={onClose}>
          resolved-close-import-modal
        </button>
      </div>
    )
  },
}))

vi.mock('../../../hooks/file-tree/operations/use-file-operations', () => ({
  useFileOperations: (...args: unknown[]) => {
    mocks.useFileOperations(...args)
    return mocks.fileOperations
  },
}))

vi.mock('.././node-menu', () => ({
  default: ({ type, menuType, nodeId, actionNodeIds, onImportSkills, onClose }: { type: string, menuType: string, nodeId?: string, actionNodeIds?: string[], onImportSkills?: () => void, onClose?: () => void }) => (
    <div
      data-testid={`node-menu-${menuType}`}
      data-type={type}
      data-node-id={nodeId ?? ''}
      data-action-node-ids={(actionNodeIds ?? []).join(',')}
    >
      {onImportSkills && (
        <button type="button" onClick={onImportSkills}>
          open-import-skill-modal
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose}>
          close-node-menu
        </button>
      )}
    </div>
  ),
}))

describe('TreeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectedNodeIds = new Set<string>()
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
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-action-node-ids', 'file-1')
      expect(mocks.useFileOperations).toHaveBeenLastCalledWith(expect.objectContaining({
        nodeId: 'file-1',
        nodeType: 'file',
        fileName: 'readme.md',
      }))
    })

    it('should preserve multi-selection when right-click target is already selected', () => {
      mocks.selectedNodeIds = new Set(['file-1', 'file-2'])
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
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByRole('treeitem'))

      expect(mocks.deselectAll).not.toHaveBeenCalled()
      expect(mocks.selectNode).not.toHaveBeenCalled()
      expect(mocks.setSelectedNodeIds).not.toHaveBeenCalled()
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-action-node-ids', 'file-1,file-2')
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

    it('should wire the dynamic import loader and the menu close callback', async () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll } as never }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('blank area'))
      fireEvent.click(screen.getByRole('button', { name: 'close-node-menu' }))

      expect(mocks.dynamicImporters).toHaveLength(1)
      await expect(mocks.dynamicImporters[0]()).resolves.toBeTruthy()
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

    it('should confirm folder deletion through the mounted dialog', () => {
      mocks.fileOperations.showDeleteConfirm = true
      mocks.getNode.mockReturnValue({
        select: mocks.selectNode,
        data: { name: 'docs' },
      })

      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll, get: mocks.getNode } as never }}>
          <div data-skill-tree-node-id="folder-1" data-skill-tree-node-type="folder" role="treeitem">
            docs
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByRole('treeitem'))
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.confirm/i, hidden: true }))

      expect(screen.getByText('workflow.skillSidebar.menu.deleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('workflow.skillSidebar.menu.deleteConfirmContent')).toBeInTheDocument()
      expect(mocks.fileOperations.handleDeleteConfirm).toHaveBeenCalledTimes(1)
    })

    it('should ignore context targets without a valid node id or menu type', () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll, get: mocks.getNode } as never }}>
          <div>
            <div data-skill-tree-node-id="" data-skill-tree-node-type="file" role="treeitem">
              invalid-file
            </div>
            <div data-skill-tree-node-id="file-2" data-skill-tree-node-type="unknown" role="treeitem">
              unknown-type
            </div>
          </div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('invalid-file'))
      fireEvent.contextMenu(screen.getByText('unknown-type'))

      expect(mocks.getNode).not.toHaveBeenCalled()
      expect(mocks.setSelectedNodeIds).not.toHaveBeenCalled()
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-type', 'root')
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-node-id', ROOT_ID)
    })
  })
})
