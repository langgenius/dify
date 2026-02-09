import type { AppAssetTreeResponse, AppAssetTreeView } from '@/types/app-asset'
import { fireEvent, render, screen } from '@testing-library/react'
import { ROOT_ID } from '../constants'
import SidebarSearchAdd from './sidebar-search-add'

type WorkflowStoreState = {
  fileTreeSearchTerm: string
  selectedTreeNodeId: string | null
}

type MockFileOperations = {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  folderInputRef: React.RefObject<HTMLInputElement | null>
  isLoading: boolean
  handleNewFile: () => void
  handleNewFolder: () => void
  handleFileChange: () => void
  handleFolderChange: () => void
}

const createFileOperations = (): MockFileOperations => ({
  fileInputRef: { current: null },
  folderInputRef: { current: null },
  isLoading: false,
  handleNewFile: vi.fn(),
  handleNewFolder: vi.fn(),
  handleFileChange: vi.fn(),
  handleFolderChange: vi.fn(),
})

const createNode = (overrides: Partial<AppAssetTreeView>): AppAssetTreeView => ({
  id: 'folder-1',
  node_type: 'folder',
  name: 'folder',
  path: '/folder',
  extension: '',
  size: 0,
  children: [],
  ...overrides,
})

const mocks = vi.hoisted(() => ({
  storeState: {
    fileTreeSearchTerm: '',
    selectedTreeNodeId: null,
  } as WorkflowStoreState,
  setFileTreeSearchTerm: vi.fn(),
  treeData: undefined as AppAssetTreeResponse | undefined,
  fileOperations: {
    fileInputRef: { current: null },
    folderInputRef: { current: null },
    isLoading: false,
    handleNewFile: vi.fn(),
    handleNewFolder: vi.fn(),
    handleFileChange: vi.fn(),
    handleFolderChange: vi.fn(),
  } as MockFileOperations,
  useFileOperations: vi.fn(),
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

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: WorkflowStoreState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      setFileTreeSearchTerm: mocks.setFileTreeSearchTerm,
    }),
  }),
}))

vi.mock('../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetTreeData: () => ({ data: mocks.treeData }),
}))

vi.mock('../hooks/file-tree/operations/use-file-operations', () => ({
  useFileOperations: (options: unknown) => {
    mocks.useFileOperations(options)
    return mocks.fileOperations
  },
}))

describe('SidebarSearchAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.fileTreeSearchTerm = ''
    mocks.storeState.selectedTreeNodeId = null
    mocks.treeData = undefined
    mocks.fileOperations = createFileOperations()
  })

  describe('Rendering', () => {
    it('should render search input and add trigger when component mounts', () => {
      // Act
      render(<SidebarSearchAdd />)

      // Assert
      expect(screen.getByPlaceholderText('workflow.skillSidebar.searchPlaceholder')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.add/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should update store search term when typing in search input', () => {
      // Arrange
      render(<SidebarSearchAdd />)
      const searchInput = screen.getByPlaceholderText('workflow.skillSidebar.searchPlaceholder')

      // Act
      fireEvent.change(searchInput, { target: { value: 'agent' } })

      // Assert
      expect(mocks.setFileTreeSearchTerm).toHaveBeenCalledTimes(1)
      expect(mocks.setFileTreeSearchTerm).toHaveBeenCalledWith('agent')
    })

    it('should call create handlers when clicking new file and new folder actions', () => {
      // Arrange
      render(<SidebarSearchAdd />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))

      // Act
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i }))

      // Assert
      expect(mocks.fileOperations.handleNewFile).toHaveBeenCalledTimes(1)
      expect(mocks.fileOperations.handleNewFolder).toHaveBeenCalledTimes(1)
    })

    it('should trigger hidden file and folder input click when upload actions are clicked', () => {
      // Arrange
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
      render(<SidebarSearchAdd />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))

      // Act
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFile/i }))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i }))

      // Assert
      expect(clickSpy).toHaveBeenCalledTimes(2)
    })

    it('should open and close import modal when import skills action is used', () => {
      // Arrange
      render(<SidebarSearchAdd />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))

      // Act
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.importSkills/i }))

      // Assert
      expect(screen.getByTestId('import-skill-modal')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByRole('button', { name: /close-import-modal/i }))

      // Assert
      expect(screen.queryByTestId('import-skill-modal')).not.toBeInTheDocument()
    })
  })

  describe('Data flow', () => {
    it('should pass root id to file operations when tree data is unavailable', () => {
      // Act
      render(<SidebarSearchAdd />)

      // Assert
      expect(mocks.useFileOperations).toHaveBeenCalledWith(expect.objectContaining({
        nodeId: ROOT_ID,
      }))
    })

    it('should pass selected parent folder id to file operations when selected node is a file', () => {
      // Arrange
      mocks.storeState.selectedTreeNodeId = 'file-1'
      mocks.treeData = {
        children: [
          createNode({
            id: 'folder-1',
            children: [
              createNode({
                id: 'file-1',
                node_type: 'file',
                name: 'readme.md',
                path: '/folder/readme.md',
                extension: 'md',
                size: 12,
              }),
            ],
          }),
        ],
      }

      // Act
      render(<SidebarSearchAdd />)

      // Assert
      expect(mocks.useFileOperations).toHaveBeenCalledWith(expect.objectContaining({
        nodeId: 'folder-1',
      }))
    })
  })

  describe('Edge Cases', () => {
    it('should disable menu actions when file operations are loading', () => {
      // Arrange
      mocks.fileOperations.isLoading = true
      render(<SidebarSearchAdd />)
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))

      // Assert
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFile/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.newFolder/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFile/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.uploadFolder/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.menu\.importSkills/i })).toBeDisabled()
    })
  })
})
