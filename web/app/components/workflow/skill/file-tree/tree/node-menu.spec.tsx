import type { ReactElement, RefObject } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import { fireEvent, render, screen } from '@testing-library/react'
import { NODE_MENU_TYPE } from '../../constants'
import NodeMenu from './node-menu'

type MockWorkflowState = {
  selectedNodeIds: Set<string>
  hasClipboard: () => boolean
}

type MockFileOperations = {
  fileInputRef: RefObject<HTMLInputElement | null>
  folderInputRef: RefObject<HTMLInputElement | null>
  showDeleteConfirm: boolean
  isLoading: boolean
  isDeleting: boolean
  handleDownload: () => void
  handleNewFile: () => void
  handleNewFolder: () => void
  handleFileChange: () => void
  handleFolderChange: () => void
  handleRename: () => void
  handleDeleteClick: () => void
  handleDeleteConfirm: () => void
  handleDeleteCancel: () => void
}

type RenderNodeMenuProps = {
  type?: 'root' | 'folder' | 'file'
  nodeId?: string
  onClose?: () => void
  treeRef?: RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
}

function createFileOperationsMock(): MockFileOperations {
  return ({
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
  })
}

const mocks = vi.hoisted(() => ({
  storeState: {
    selectedNodeIds: new Set<string>(),
    hasClipboard: () => false,
  } as MockWorkflowState,
  cutNodes: vi.fn(),
  fileOperations: createFileOperationsMock(),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockImportSkillModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }): ReactElement | null => {
      if (!isOpen)
        return null

      return (
        <div data-testid="import-skill-modal">
          <button type="button" onClick={onClose}>close-import-modal</button>
        </div>
      )
    }

    return MockImportSkillModal
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      cutNodes: mocks.cutNodes,
    }),
  }),
}))

vi.mock('../../hooks/file-tree/operations/use-file-operations', () => ({
  useFileOperations: () => mocks.fileOperations,
}))

const renderNodeMenu = ({
  type = NODE_MENU_TYPE.FOLDER,
  nodeId = 'node-1',
  onClose = vi.fn(),
  treeRef,
  node,
}: RenderNodeMenuProps = {}) => {
  render(
    <NodeMenu
      type={type}
      nodeId={nodeId}
      onClose={onClose}
      treeRef={treeRef}
      node={node}
    />,
  )

  return { onClose }
}

describe('NodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.selectedNodeIds = new Set<string>()
    mocks.storeState.hasClipboard = () => false
    mocks.fileOperations = createFileOperationsMock()
  })

  describe('Rendering', () => {
    it('should render root folder actions and hide file-only actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.ROOT })

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFile/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.importSkills/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.cut/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.rename/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.delete/i })).not.toBeInTheDocument()
    })

    it('should render file actions and hide folder-only actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FILE })

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.download/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.cut/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.rename/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.delete/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.menu\.paste/i })).not.toBeInTheDocument()
    })

    it('should disable menu actions when file operations are loading', () => {
      mocks.fileOperations.isLoading = true
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFile/i })).toBeDisabled()
    })
  })

  describe('Menu actions', () => {
    it('should trigger create operations when clicking new file and new folder', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i }))

      expect(mocks.fileOperations.handleNewFile).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleNewFolder).toHaveBeenCalledTimes(1)
    })

    it('should trigger hidden file and folder input clicks from upload actions', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFile/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i }))

      expect(clickSpy).toHaveBeenCalledTimes(2)
    })

    it('should cut selected nodes and close menu when cut is clicked', () => {
      mocks.storeState.selectedNodeIds = new Set(['file-1', 'file-2'])
      const { onClose } = renderNodeMenu({ type: NODE_MENU_TYPE.FILE, nodeId: 'fallback-id' })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.cut/i }))

      expect(mocks.cutNodes).toHaveBeenCalledTimes(1)
      expect(mocks.cutNodes).toHaveBeenCalledWith(['file-1', 'file-2'])
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should cut current node id when no multi-selection exists', () => {
      const { onClose } = renderNodeMenu({ type: NODE_MENU_TYPE.FILE, nodeId: 'file-3' })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.cut/i }))

      expect(mocks.cutNodes).toHaveBeenCalledWith(['file-3'])
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should dispatch paste event and close when paste is clicked', () => {
      mocks.storeState.hasClipboard = () => true
      const pasteListener = vi.fn()
      window.addEventListener('skill:paste', pasteListener)
      const { onClose } = renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.paste/i }))

      expect(pasteListener).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
      window.removeEventListener('skill:paste', pasteListener)
    })

    it('should call download, rename, and delete handlers for file menu actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FILE })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.download/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.rename/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.delete/i }))

      expect(mocks.fileOperations.handleDownload).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleRename).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleDeleteClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Dialogs', () => {
    it('should open and close import modal from root menu', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.ROOT })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.importSkills/i }))
      expect(screen.getByTestId('import-skill-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /close-import-modal/i }))
      expect(screen.queryByTestId('import-skill-modal')).not.toBeInTheDocument()
    })

    it('should render delete confirmation content for files and forward confirm callbacks', () => {
      mocks.fileOperations.showDeleteConfirm = true
      renderNodeMenu({ type: NODE_MENU_TYPE.FILE })

      expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('workflow.skillSidebar.menu.fileDeleteConfirmContent')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(mocks.fileOperations.handleDeleteConfirm).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleDeleteCancel).toHaveBeenCalledTimes(1)
    })
  })
})
