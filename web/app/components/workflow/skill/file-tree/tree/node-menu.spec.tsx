import type { RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/app/components/base/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { NODE_MENU_TYPE } from '../../constants'
import NodeMenu from './node-menu'

type MockWorkflowState = {
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
  menuType?: 'dropdown' | 'context'
  nodeId?: string
  actionNodeIds?: string[]
  onClose?: () => void
  onImportSkills?: () => void
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
    hasClipboard: () => false,
  } as MockWorkflowState,
  cutNodes: vi.fn(),
  setFileTreeSearchTerm: vi.fn(),
  fileOperations: createFileOperationsMock(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      cutNodes: mocks.cutNodes,
      setFileTreeSearchTerm: mocks.setFileTreeSearchTerm,
    }),
  }),
}))

const renderNodeMenu = ({
  type = NODE_MENU_TYPE.FOLDER,
  menuType = 'dropdown',
  nodeId = 'node-1',
  actionNodeIds,
  onClose = vi.fn(),
  onImportSkills,
}: RenderNodeMenuProps = {}) => {
  const ui = menuType === 'dropdown'
    ? (
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <NodeMenu
              type={type}
              menuType={menuType}
              nodeId={nodeId}
              actionNodeIds={actionNodeIds}
              onClose={onClose}
              fileInputRef={mocks.fileOperations.fileInputRef}
              folderInputRef={mocks.fileOperations.folderInputRef}
              isLoading={mocks.fileOperations.isLoading}
              onDownload={mocks.fileOperations.handleDownload}
              onNewFile={mocks.fileOperations.handleNewFile}
              onNewFolder={mocks.fileOperations.handleNewFolder}
              onFileChange={mocks.fileOperations.handleFileChange}
              onFolderChange={mocks.fileOperations.handleFolderChange}
              onRename={mocks.fileOperations.handleRename}
              onDeleteClick={mocks.fileOperations.handleDeleteClick}
              onImportSkills={onImportSkills}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )
    : (
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <NodeMenu
              type={type}
              menuType={menuType}
              nodeId={nodeId}
              actionNodeIds={actionNodeIds}
              onClose={onClose}
              fileInputRef={mocks.fileOperations.fileInputRef}
              folderInputRef={mocks.fileOperations.folderInputRef}
              isLoading={mocks.fileOperations.isLoading}
              onDownload={mocks.fileOperations.handleDownload}
              onNewFile={mocks.fileOperations.handleNewFile}
              onNewFolder={mocks.fileOperations.handleNewFolder}
              onFileChange={mocks.fileOperations.handleFileChange}
              onFolderChange={mocks.fileOperations.handleFolderChange}
              onRename={mocks.fileOperations.handleRename}
              onDeleteClick={mocks.fileOperations.handleDeleteClick}
              onImportSkills={onImportSkills}
            />
          </ContextMenuContent>
        </ContextMenu>
      )

  render(
    ui,
  )

  return { onClose }
}

describe('NodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.hasClipboard = () => false
    mocks.fileOperations = createFileOperationsMock()
  })

  describe('Rendering', () => {
    it('should render root folder actions and hide file-only actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.ROOT })

      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFile/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.uploadFile/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.importSkills/i })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.cut/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.rename/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.delete/i })).not.toBeInTheDocument()
    })

    it('should render file actions and hide folder-only actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FILE })

      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.download/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.cut/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.rename/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.delete/i })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFile/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.paste/i })).not.toBeInTheDocument()
    })

    it('should disable menu actions when file operations are loading', () => {
      mocks.fileOperations.isLoading = true
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFile/i })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.uploadFile/i })).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Menu actions', () => {
    it('should trigger create operations when clicking new file and new folder', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFile/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.newFolder/i }))

      expect(mocks.setFileTreeSearchTerm).toHaveBeenNthCalledWith(1, '')
      expect(mocks.setFileTreeSearchTerm).toHaveBeenNthCalledWith(2, '')
      expect(mocks.fileOperations.handleNewFile).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleNewFolder).toHaveBeenCalledTimes(1)
    })

    it('should trigger hidden file and folder input clicks from upload actions', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
      renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.uploadFile/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i }))

      expect(clickSpy).toHaveBeenCalledTimes(2)
    })

    it('should cut explicit action node ids and close menu when cut is clicked', () => {
      const { onClose } = renderNodeMenu({
        type: NODE_MENU_TYPE.FILE,
        nodeId: 'fallback-id',
        actionNodeIds: ['file-1', 'file-2'],
      })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.cut/i }))

      expect(mocks.cutNodes).toHaveBeenCalledTimes(1)
      expect(mocks.cutNodes).toHaveBeenCalledWith(['file-1', 'file-2'])
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should cut current node id when no multi-selection exists', () => {
      const { onClose } = renderNodeMenu({ type: NODE_MENU_TYPE.FILE, nodeId: 'file-3' })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.cut/i }))

      expect(mocks.cutNodes).toHaveBeenCalledWith(['file-3'])
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should dispatch paste event and close when paste is clicked', () => {
      mocks.storeState.hasClipboard = () => true
      const pasteListener = vi.fn()
      window.addEventListener('skill:paste', pasteListener)
      const { onClose } = renderNodeMenu({ type: NODE_MENU_TYPE.FOLDER })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.paste/i }))

      expect(pasteListener).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
      window.removeEventListener('skill:paste', pasteListener)
    })

    it('should call download, rename, and delete handlers for file menu actions', () => {
      renderNodeMenu({ type: NODE_MENU_TYPE.FILE })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.download/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.rename/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.delete/i }))

      expect(mocks.fileOperations.handleDownload).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleRename).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleDeleteClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Dialogs', () => {
    it('should call import handler from root menu', () => {
      const onImportSkills = vi.fn()
      renderNodeMenu({ type: NODE_MENU_TYPE.ROOT, onImportSkills })

      fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.skillSidebar\.menu\.importSkills/i }))
      expect(onImportSkills).toHaveBeenCalledTimes(1)
    })
  })
})
