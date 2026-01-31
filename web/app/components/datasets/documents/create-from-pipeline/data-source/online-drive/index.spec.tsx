import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { OnlineDriveData } from '@/types/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import Header from './header'
import OnlineDrive from './index'
import { convertOnlineDriveData, isBucketListInitiation, isFile } from './utils'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock useDocLink - context hook requires mocking
const mockDocLink = vi.fn((path?: string) => `https://docs.example.com${path || ''}`)
vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

// Mock dataset-detail context - context provider requires mocking
let mockPipelineId: string | undefined = 'pipeline-123'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (s: any) => any) => selector({ dataset: { pipeline_id: mockPipelineId } }),
}))

// Mock modal context - context provider requires mocking
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (s: any) => any) => selector({ setShowAccountSettingModal: mockSetShowAccountSettingModal }),
}))

// Mock ssePost - API service requires mocking
const { mockSsePost } = vi.hoisted(() => ({
  mockSsePost: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  ssePost: mockSsePost,
}))

// Mock useGetDataSourceAuth - API service hook requires mocking
const { mockUseGetDataSourceAuth } = vi.hoisted(() => ({
  mockUseGetDataSourceAuth: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceAuth: mockUseGetDataSourceAuth,
}))

// Mock Toast
const { mockToastNotify } = vi.hoisted(() => ({
  mockToastNotify: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
  },
}))

// Note: zustand/react/shallow useShallow is imported directly (simple utility function)

// Mock store state
const mockStoreState = {
  nextPageParameters: {} as Record<string, any>,
  breadcrumbs: [] as string[],
  prefix: [] as string[],
  keywords: '',
  bucket: '',
  selectedFileIds: [] as string[],
  onlineDriveFileList: [] as OnlineDriveFile[],
  currentCredentialId: '',
  isTruncated: { current: false },
  currentNextPageParametersRef: { current: {} },
  setOnlineDriveFileList: vi.fn(),
  setKeywords: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
  setHasBucket: vi.fn(),
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../store', () => ({
  useDataSourceStoreWithSelector: (selector: (s: any) => any) => selector(mockStoreState),
  useDataSourceStore: () => mockDataSourceStore,
}))

// Mock Header component
vi.mock('../base/header', () => ({
  default: (props: any) => (
    <div data-testid="header">
      <span data-testid="header-doc-title">{props.docTitle}</span>
      <span data-testid="header-doc-link">{props.docLink}</span>
      <span data-testid="header-plugin-name">{props.pluginName}</span>
      <span data-testid="header-credential-id">{props.currentCredentialId}</span>
      <button data-testid="header-config-btn" onClick={props.onClickConfiguration}>Configure</button>
      <button data-testid="header-credential-change" onClick={() => props.onCredentialChange('new-cred-id')}>Change Credential</button>
      <span data-testid="header-credentials-count">{props.credentials?.length || 0}</span>
    </div>
  ),
}))

// Mock FileList component
vi.mock('./file-list', () => ({
  default: (props: any) => (
    <div data-testid="file-list">
      <span data-testid="file-list-count">{props.fileList?.length || 0}</span>
      <span data-testid="file-list-selected-count">{props.selectedFileIds?.length || 0}</span>
      <span data-testid="file-list-breadcrumbs">{props.breadcrumbs?.join('/') || ''}</span>
      <span data-testid="file-list-keywords">{props.keywords}</span>
      <span data-testid="file-list-bucket">{props.bucket}</span>
      <span data-testid="file-list-loading">{String(props.isLoading)}</span>
      <span data-testid="file-list-is-in-pipeline">{String(props.isInPipeline)}</span>
      <span data-testid="file-list-support-batch">{String(props.supportBatchUpload)}</span>
      <input
        data-testid="file-list-search-input"
        onChange={e => props.updateKeywords(e.target.value)}
      />
      <button data-testid="file-list-reset-keywords" onClick={props.resetKeywords}>Reset</button>
      <button
        data-testid="file-list-select-file"
        onClick={() => {
          const file: OnlineDriveFile = { id: 'file-1', name: 'test.txt', type: OnlineDriveFileType.file }
          props.handleSelectFile(file)
        }}
      >
        Select File
      </button>
      <button
        data-testid="file-list-select-bucket"
        onClick={() => {
          const file: OnlineDriveFile = { id: 'bucket-1', name: 'my-bucket', type: OnlineDriveFileType.bucket }
          props.handleSelectFile(file)
        }}
      >
        Select Bucket
      </button>
      <button
        data-testid="file-list-open-folder"
        onClick={() => {
          const file: OnlineDriveFile = { id: 'folder-1', name: 'my-folder', type: OnlineDriveFileType.folder }
          props.handleOpenFolder(file)
        }}
      >
        Open Folder
      </button>
      <button
        data-testid="file-list-open-bucket"
        onClick={() => {
          const file: OnlineDriveFile = { id: 'bucket-1', name: 'my-bucket', type: OnlineDriveFileType.bucket }
          props.handleOpenFolder(file)
        }}
      >
        Open Bucket
      </button>
      <button
        data-testid="file-list-open-file"
        onClick={() => {
          const file: OnlineDriveFile = { id: 'file-1', name: 'test.txt', type: OnlineDriveFileType.file }
          props.handleOpenFolder(file)
        }}
      >
        Open File
      </button>
    </div>
  ),
}))

// ==========================================
// Test Data Builders
// ==========================================
const createMockNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  plugin_id: 'plugin-123',
  provider_type: 'online_drive',
  provider_name: 'online-drive-provider',
  datasource_name: 'online-drive-ds',
  datasource_label: 'Online Drive',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

const createMockOnlineDriveFile = (overrides?: Partial<OnlineDriveFile>): OnlineDriveFile => ({
  id: 'file-1',
  name: 'test-file.txt',
  size: 1024,
  type: OnlineDriveFileType.file,
  ...overrides,
})

const createMockCredential = (overrides?: Partial<{ id: string, name: string }>) => ({
  id: 'cred-1',
  name: 'Test Credential',
  avatar_url: 'https://example.com/avatar.png',
  credential: {},
  is_default: false,
  type: 'oauth2',
  ...overrides,
})

type OnlineDriveProps = React.ComponentProps<typeof OnlineDrive>

const createDefaultProps = (overrides?: Partial<OnlineDriveProps>): OnlineDriveProps => ({
  nodeId: 'node-1',
  nodeData: createMockNodeData(),
  onCredentialChange: vi.fn(),
  isInPipeline: false,
  supportBatchUpload: true,
  ...overrides,
})

// ==========================================
// Helper Functions
// ==========================================
const resetMockStoreState = () => {
  mockStoreState.nextPageParameters = {}
  mockStoreState.breadcrumbs = []
  mockStoreState.prefix = []
  mockStoreState.keywords = ''
  mockStoreState.bucket = ''
  mockStoreState.selectedFileIds = []
  mockStoreState.onlineDriveFileList = []
  mockStoreState.currentCredentialId = ''
  mockStoreState.isTruncated = { current: false }
  mockStoreState.currentNextPageParametersRef = { current: {} }
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setKeywords = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
  mockStoreState.setHasBucket = vi.fn()
}

// ==========================================
// Test Suites
// ==========================================
describe('OnlineDrive', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state
    resetMockStoreState()

    // Reset context values
    mockPipelineId = 'pipeline-123'
    mockSetShowAccountSettingModal.mockClear()

    // Default mock return values
    mockUseGetDataSourceAuth.mockReturnValue({
      data: { result: [createMockCredential()] },
    })

    mockGetState.mockReturnValue(mockStoreState)
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('header')).toBeInTheDocument()
      expect(screen.getByTestId('file-list')).toBeInTheDocument()
    })

    it('should render Header with correct props', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-123'
      const props = createDefaultProps({
        nodeData: createMockNodeData({ datasource_label: 'My Online Drive' }),
      })

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('header-doc-title')).toHaveTextContent('Docs')
      expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('My Online Drive')
      expect(screen.getByTestId('header-credential-id')).toHaveTextContent('cred-123')
    })

    it('should render FileList with correct props', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.keywords = 'search-term'
      mockStoreState.breadcrumbs = ['folder1', 'folder2']
      mockStoreState.bucket = 'my-bucket'
      mockStoreState.selectedFileIds = ['file-1', 'file-2']
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: 'file-1', name: 'file1.txt' }),
        createMockOnlineDriveFile({ id: 'file-2', name: 'file2.txt' }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list')).toBeInTheDocument()
      expect(screen.getByTestId('file-list-keywords')).toHaveTextContent('search-term')
      expect(screen.getByTestId('file-list-breadcrumbs')).toHaveTextContent('folder1/folder2')
      expect(screen.getByTestId('file-list-bucket')).toHaveTextContent('my-bucket')
      expect(screen.getByTestId('file-list-selected-count')).toHaveTextContent('2')
    })

    it('should pass docLink with correct path to Header', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(mockDocLink).toHaveBeenCalledWith('/use-dify/knowledge/knowledge-pipeline/authorize-data-source')
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('nodeId prop', () => {
      it('should use nodeId in datasourceNodeRunURL for non-pipeline mode', async () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({
          nodeId: 'custom-node-id',
          isInPipeline: false,
        })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert - ssePost should be called with correct URL
        await waitFor(() => {
          expect(mockSsePost).toHaveBeenCalledWith(
            expect.stringContaining('/rag/pipelines/pipeline-123/workflows/published/datasource/nodes/custom-node-id/run'),
            expect.any(Object),
            expect.any(Object),
          )
        })
      })

      it('should use nodeId in datasourceNodeRunURL for pipeline mode', async () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({
          nodeId: 'custom-node-id',
          isInPipeline: true,
        })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert - ssePost should be called with correct URL for draft
        await waitFor(() => {
          expect(mockSsePost).toHaveBeenCalledWith(
            expect.stringContaining('/rag/pipelines/pipeline-123/workflows/draft/datasource/nodes/custom-node-id/run'),
            expect.any(Object),
            expect.any(Object),
          )
        })
      })
    })

    describe('nodeData prop', () => {
      it('should pass plugin_id and provider_name to useGetDataSourceAuth', () => {
        // Arrange
        const nodeData = createMockNodeData({
          plugin_id: 'my-plugin-id',
          provider_name: 'my-provider',
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
          pluginId: 'my-plugin-id',
          provider: 'my-provider',
        })
      })

      it('should pass datasource_label to Header as pluginName', () => {
        // Arrange
        const nodeData = createMockNodeData({
          datasource_label: 'Custom Online Drive',
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('Custom Online Drive')
      })
    })

    describe('isInPipeline prop', () => {
      it('should use draft URL when isInPipeline is true', async () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        await waitFor(() => {
          expect(mockSsePost).toHaveBeenCalledWith(
            expect.stringContaining('/workflows/draft/'),
            expect.any(Object),
            expect.any(Object),
          )
        })
      })

      it('should use published URL when isInPipeline is false', async () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({ isInPipeline: false })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        await waitFor(() => {
          expect(mockSsePost).toHaveBeenCalledWith(
            expect.stringContaining('/workflows/published/'),
            expect.any(Object),
            expect.any(Object),
          )
        })
      })

      it('should pass isInPipeline to FileList', () => {
        // Arrange
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(screen.getByTestId('file-list-is-in-pipeline')).toHaveTextContent('true')
      })
    })

    describe('supportBatchUpload prop', () => {
      it('should pass supportBatchUpload true to FileList when supportBatchUpload is true', () => {
        // Arrange
        const props = createDefaultProps({ supportBatchUpload: true })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(screen.getByTestId('file-list-support-batch')).toHaveTextContent('true')
      })

      it('should pass supportBatchUpload false to FileList when supportBatchUpload is false', () => {
        // Arrange
        const props = createDefaultProps({ supportBatchUpload: false })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(screen.getByTestId('file-list-support-batch')).toHaveTextContent('false')
      })

      it.each([
        [true, 'true'],
        [false, 'false'],
        [undefined, 'true'], // Default value
      ])('should handle supportBatchUpload=%s correctly', (value, expected) => {
        // Arrange
        const props = createDefaultProps({ supportBatchUpload: value })

        // Act
        render(<OnlineDrive {...props} />)

        // Assert
        expect(screen.getByTestId('file-list-support-batch')).toHaveTextContent(expected)
      })
    })

    describe('onCredentialChange prop', () => {
      it('should call onCredentialChange with credential id', () => {
        // Arrange
        const mockOnCredentialChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })

        // Act
        render(<OnlineDrive {...props} />)
        fireEvent.click(screen.getByTestId('header-credential-change'))

        // Assert
        expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
      })
    })
  })

  // ==========================================
  // State Management Tests
  // ==========================================
  describe('State Management', () => {
    it('should fetch files on initial mount when fileList is empty', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = []
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should not fetch files on initial mount when fileList is not empty', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert - Wait a bit to ensure no call is made
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(mockSsePost).not.toHaveBeenCalled()
    })

    it('should not fetch files when currentCredentialId is empty', async () => {
      // Arrange
      mockStoreState.currentCredentialId = ''
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert - Wait a bit to ensure no call is made
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(mockSsePost).not.toHaveBeenCalled()
    })

    it('should show loading state during fetch', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockSsePost.mockImplementation(() => {
        // Never resolves to keep loading state
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('file-list-loading')).toHaveTextContent('true')
      })
    })

    it('should update file list on successful fetch', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockFiles = [
        { id: 'file-1', name: 'file1.txt', type: 'file' as const },
        { id: 'file-2', name: 'file2.txt', type: 'file' as const },
      ]
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: [{
            bucket: '',
            files: mockFiles,
            is_truncated: false,
            next_page_parameters: {},
          }],
          time_consuming: 1.0,
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalled()
      })
    })

    it('should show error toast on fetch error', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const errorMessage = 'Failed to fetch files'
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: errorMessage,
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: errorMessage,
        })
      })
    })
  })

  // ==========================================
  // Memoization Logic and Dependencies Tests
  // ==========================================
  describe('Memoization Logic', () => {
    it('should filter files by keywords', () => {
      // Arrange
      mockStoreState.keywords = 'test'
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: '1', name: 'test-file.txt' }),
        createMockOnlineDriveFile({ id: '2', name: 'other-file.txt' }),
        createMockOnlineDriveFile({ id: '3', name: 'another-test.pdf' }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert - filteredOnlineDriveFileList should have 2 items matching 'test'
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('2')
    })

    it('should return all files when keywords is empty', () => {
      // Arrange
      mockStoreState.keywords = ''
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: '1', name: 'file1.txt' }),
        createMockOnlineDriveFile({ id: '2', name: 'file2.txt' }),
        createMockOnlineDriveFile({ id: '3', name: 'file3.pdf' }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('3')
    })

    it('should filter files case-insensitively', () => {
      // Arrange
      mockStoreState.keywords = 'TEST'
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: '1', name: 'test-file.txt' }),
        createMockOnlineDriveFile({ id: '2', name: 'Test-Document.pdf' }),
        createMockOnlineDriveFile({ id: '3', name: 'other.txt' }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('2')
    })
  })

  // ==========================================
  // Callback Stability and Memoization
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should have stable handleSetting callback', () => {
      // Arrange
      const props = createDefaultProps()
      render(<OnlineDrive {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-config-btn'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
      })
    })

    it('should have stable updateKeywords that updates store', () => {
      // Arrange
      const props = createDefaultProps()
      render(<OnlineDrive {...props} />)

      // Act
      fireEvent.change(screen.getByTestId('file-list-search-input'), { target: { value: 'new-keyword' } })

      // Assert
      expect(mockStoreState.setKeywords).toHaveBeenCalledWith('new-keyword')
    })

    it('should have stable resetKeywords that clears keywords', () => {
      // Arrange
      mockStoreState.keywords = 'old-keyword'
      const props = createDefaultProps()
      render(<OnlineDrive {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('file-list-reset-keywords'))

      // Assert
      expect(mockStoreState.setKeywords).toHaveBeenCalledWith('')
    })
  })

  // ==========================================
  // User Interactions and Event Handlers
  // ==========================================
  describe('User Interactions', () => {
    describe('File Selection', () => {
      it('should toggle file selection on file click', () => {
        // Arrange
        mockStoreState.selectedFileIds = []
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-select-file'))

        // Assert
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith(['file-1'])
      })

      it('should deselect file if already selected', () => {
        // Arrange
        mockStoreState.selectedFileIds = ['file-1']
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-select-file'))

        // Assert
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
      })

      it('should not select bucket type items', () => {
        // Arrange
        mockStoreState.selectedFileIds = []
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-select-bucket'))

        // Assert
        expect(mockStoreState.setSelectedFileIds).not.toHaveBeenCalled()
      })

      it('should limit selection to one file when supportBatchUpload is false', () => {
        // Arrange
        mockStoreState.selectedFileIds = ['existing-file']
        const props = createDefaultProps({ supportBatchUpload: false })
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-select-file'))

        // Assert - Should not add new file because there's already one selected
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith(['existing-file'])
      })

      it('should allow multiple selections when supportBatchUpload is true', () => {
        // Arrange
        mockStoreState.selectedFileIds = ['existing-file']
        const props = createDefaultProps({ supportBatchUpload: true })
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-select-file'))

        // Assert
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith(['existing-file', 'file-1'])
      })
    })

    describe('Folder Navigation', () => {
      it('should open folder and update breadcrumbs/prefix', () => {
        // Arrange
        mockStoreState.breadcrumbs = []
        mockStoreState.prefix = []
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-open-folder'))

        // Assert
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith(['my-folder'])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith(['folder-1'])
      })

      it('should open bucket and set bucket name', () => {
        // Arrange
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-open-bucket'))

        // Assert
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setBucket).toHaveBeenCalledWith('my-bucket')
      })

      it('should not navigate when opening a file', () => {
        // Arrange
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('file-list-open-file'))

        // Assert - No navigation functions should be called
        expect(mockStoreState.setBreadcrumbs).not.toHaveBeenCalled()
        expect(mockStoreState.setPrefix).not.toHaveBeenCalled()
        expect(mockStoreState.setBucket).not.toHaveBeenCalled()
      })
    })

    describe('Credential Change', () => {
      it('should call onCredentialChange prop', () => {
        // Arrange
        const mockOnCredentialChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('header-credential-change'))

        // Assert
        expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
      })
    })

    describe('Configuration', () => {
      it('should open account setting modal on configuration click', () => {
        // Arrange
        const props = createDefaultProps()
        render(<OnlineDrive {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('header-config-btn'))

        // Assert
        expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
          payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
        })
      })
    })
  })

  // ==========================================
  // Side Effects and Cleanup Tests
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    it('should fetch files when nextPageParameters changes after initial mount', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const props = createDefaultProps()
      const { rerender } = render(<OnlineDrive {...props} />)

      // Act - Simulate nextPageParameters change by re-rendering with updated state
      mockStoreState.nextPageParameters = { page: 2 }
      rerender(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should fetch files when prefix changes after initial mount', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const props = createDefaultProps()
      const { rerender } = render(<OnlineDrive {...props} />)

      // Act - Simulate prefix change by re-rendering with updated state
      mockStoreState.prefix = ['folder1']
      rerender(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should fetch files when bucket changes after initial mount', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const props = createDefaultProps()
      const { rerender } = render(<OnlineDrive {...props} />)

      // Act - Simulate bucket change by re-rendering with updated state
      mockStoreState.bucket = 'new-bucket'
      rerender(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should fetch files when currentCredentialId changes after initial mount', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.onlineDriveFileList = [createMockOnlineDriveFile()]
      const props = createDefaultProps()
      const { rerender } = render(<OnlineDrive {...props} />)

      // Act - Simulate credential change by re-rendering with updated state
      mockStoreState.currentCredentialId = 'cred-2'
      rerender(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalled()
      })
    })

    it('should not fetch files concurrently (debounce)', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      let resolveFirst: () => void
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      mockSsePost.mockImplementationOnce((url, options, callbacks) => {
        firstPromise.then(() => {
          callbacks.onDataSourceNodeCompleted({
            data: [{ bucket: '', files: [], is_truncated: false, next_page_parameters: {} }],
            time_consuming: 1.0,
          })
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Try to trigger another fetch while first is loading
      mockStoreState.prefix = ['folder1']

      // Assert - Only one call should be made initially due to isLoadingRef guard
      expect(mockSsePost).toHaveBeenCalledTimes(1)

      // Cleanup
      resolveFirst!()
    })
  })

  // ==========================================
  // API Calls Mocking Tests
  // ==========================================
  describe('API Calls', () => {
    it('should call ssePost with correct parameters', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.prefix = ['folder1']
      mockStoreState.bucket = 'my-bucket'
      mockStoreState.nextPageParameters = { cursor: 'abc' }
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.any(String),
          {
            body: {
              inputs: {
                prefix: 'folder1',
                bucket: 'my-bucket',
                next_page_parameters: { cursor: 'abc' },
                max_keys: 30,
              },
              datasource_type: DatasourceType.onlineDrive,
              credential_id: 'cred-1',
            },
          },
          expect.objectContaining({
            onDataSourceNodeCompleted: expect.any(Function),
            onDataSourceNodeError: expect.any(Function),
          }),
        )
      })
    })

    it('should handle completed response and update store', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.breadcrumbs = ['folder1']
      mockStoreState.bucket = 'my-bucket'
      const mockResponseData = [{
        bucket: 'my-bucket',
        files: [
          { id: 'file-1', name: 'file1.txt', size: 1024, type: 'file' as const },
          { id: 'file-2', name: 'file2.txt', size: 2048, type: 'file' as const },
        ],
        is_truncated: true,
        next_page_parameters: { cursor: 'next-cursor' },
      }]
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: mockResponseData,
          time_consuming: 1.5,
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalled()
        expect(mockStoreState.setHasBucket).toHaveBeenCalledWith(true)
        expect(mockStoreState.isTruncated.current).toBe(true)
        expect(mockStoreState.currentNextPageParametersRef.current).toEqual({ cursor: 'next-cursor' })
      })
    })

    it('should handle error response and show toast', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const errorMessage = 'Access denied'
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          error: errorMessage,
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: errorMessage,
        })
      })
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty credentials list', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: [] },
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle undefined credentials data', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: undefined,
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle undefined pipelineId', async () => {
      // Arrange
      mockPipelineId = undefined
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert - Should still attempt to call ssePost with undefined in URL
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.stringContaining('/rag/pipelines/undefined/'),
          expect.any(Object),
          expect.any(Object),
        )
      })
    })

    it('should handle empty file list', () => {
      // Arrange
      mockStoreState.onlineDriveFileList = []
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('0')
    })

    it('should handle empty breadcrumbs', () => {
      // Arrange
      mockStoreState.breadcrumbs = []
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-breadcrumbs')).toHaveTextContent('')
    })

    it('should handle empty bucket', () => {
      // Arrange
      mockStoreState.bucket = ''
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-bucket')).toHaveTextContent('')
    })

    it('should handle special characters in keywords', () => {
      // Arrange
      mockStoreState.keywords = 'test.file[1]'
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: '1', name: 'test.file[1].txt' }),
        createMockOnlineDriveFile({ id: '2', name: 'other.txt' }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert - Should find file with special characters
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('1')
    })

    it('should handle very long file names', () => {
      // Arrange
      const longName = `${'a'.repeat(500)}.txt`
      mockStoreState.onlineDriveFileList = [
        createMockOnlineDriveFile({ id: '1', name: longName }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('file-list-count')).toHaveTextContent('1')
    })

    it('should handle bucket list initiation response', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockStoreState.bucket = ''
      mockStoreState.prefix = []
      const mockBucketResponse = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
        { bucket: 'bucket-2', files: [], is_truncated: false, next_page_parameters: {} },
      ]
      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          data: mockBucketResponse,
          time_consuming: 1.0,
        })
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setHasBucket).toHaveBeenCalledWith(true)
      })
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      { isInPipeline: true, supportBatchUpload: true },
      { isInPipeline: true, supportBatchUpload: false },
      { isInPipeline: false, supportBatchUpload: true },
      { isInPipeline: false, supportBatchUpload: false },
    ])('should render correctly with isInPipeline=%s and supportBatchUpload=%s', (propVariation) => {
      // Arrange
      const props = createDefaultProps(propVariation)

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(screen.getByTestId('header')).toBeInTheDocument()
      expect(screen.getByTestId('file-list')).toBeInTheDocument()
      expect(screen.getByTestId('file-list-is-in-pipeline')).toHaveTextContent(String(propVariation.isInPipeline))
      expect(screen.getByTestId('file-list-support-batch')).toHaveTextContent(String(propVariation.supportBatchUpload))
    })

    it.each([
      { nodeId: 'node-a', expectedUrlPart: 'nodes/node-a/run' },
      { nodeId: 'node-b', expectedUrlPart: 'nodes/node-b/run' },
      { nodeId: '123-456', expectedUrlPart: 'nodes/123-456/run' },
    ])('should use correct URL for nodeId=%s', async ({ nodeId, expectedUrlPart }) => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps({ nodeId })

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.stringContaining(expectedUrlPart),
          expect.any(Object),
          expect.any(Object),
        )
      })
    })

    it.each([
      { pluginId: 'plugin-a', providerName: 'provider-a' },
      { pluginId: 'plugin-b', providerName: 'provider-b' },
      { pluginId: '', providerName: '' },
    ])('should call useGetDataSourceAuth with pluginId=%s and providerName=%s', ({ pluginId, providerName }) => {
      // Arrange
      const props = createDefaultProps({
        nodeData: createMockNodeData({
          plugin_id: pluginId,
          provider_name: providerName,
        }),
      })

      // Act
      render(<OnlineDrive {...props} />)

      // Assert
      expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
        pluginId,
        provider: providerName,
      })
    })
  })
})

// ==========================================
// Header Component Tests
// ==========================================
describe('Header', () => {
  const createHeaderProps = (overrides?: Partial<React.ComponentProps<typeof Header>>) => ({
    onClickConfiguration: vi.fn(),
    docTitle: 'Documentation',
    docLink: 'https://docs.example.com/guide',
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createHeaderProps()

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText('Documentation')).toBeInTheDocument()
    })

    it('should render doc link with correct href', () => {
      // Arrange
      const props = createHeaderProps({
        docLink: 'https://custom-docs.com/path',
        docTitle: 'Custom Docs',
      })

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://custom-docs.com/path')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render doc title text', () => {
      // Arrange
      const props = createHeaderProps({ docTitle: 'My Documentation Title' })

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText('My Documentation Title')).toBeInTheDocument()
    })

    it('should render configuration button', () => {
      // Arrange
      const props = createHeaderProps()

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('docTitle prop', () => {
      it.each([
        'Getting Started',
        'API Reference',
        'Installation Guide',
        '',
      ])('should render docTitle="%s"', (docTitle) => {
        // Arrange
        const props = createHeaderProps({ docTitle })

        // Act
        render(<Header {...props} />)

        // Assert
        if (docTitle)
          expect(screen.getByText(docTitle)).toBeInTheDocument()
      })
    })

    describe('docLink prop', () => {
      it.each([
        'https://docs.example.com',
        'https://docs.example.com/path/to/page',
        '/relative/path',
      ])('should set href to "%s"', (docLink) => {
        // Arrange
        const props = createHeaderProps({ docLink })

        // Act
        render(<Header {...props} />)

        // Assert
        expect(screen.getByRole('link')).toHaveAttribute('href', docLink)
      })
    })

    describe('onClickConfiguration prop', () => {
      it('should call onClickConfiguration when configuration icon is clicked', () => {
        // Arrange
        const mockOnClickConfiguration = vi.fn()
        const props = createHeaderProps({ onClickConfiguration: mockOnClickConfiguration })

        // Act
        render(<Header {...props} />)
        const configIcon = screen.getByRole('button').querySelector('svg')
        fireEvent.click(configIcon!)

        // Assert
        expect(mockOnClickConfiguration).toHaveBeenCalledTimes(1)
      })

      it('should not throw when onClickConfiguration is undefined', () => {
        // Arrange
        const props = createHeaderProps({ onClickConfiguration: undefined })

        // Act & Assert
        expect(() => render(<Header {...props} />)).not.toThrow()
      })
    })
  })

  describe('Accessibility', () => {
    it('should have accessible link with title attribute', () => {
      // Arrange
      const props = createHeaderProps({ docTitle: 'Accessible Title' })

      // Act
      render(<Header {...props} />)

      // Assert
      const titleSpan = screen.getByTitle('Accessible Title')
      expect(titleSpan).toBeInTheDocument()
    })
  })
})

// ==========================================
// Utils Tests
// ==========================================
describe('utils', () => {
  // ==========================================
  // isFile Tests
  // ==========================================
  describe('isFile', () => {
    it('should return true for file type', () => {
      // Act & Assert
      expect(isFile('file')).toBe(true)
    })

    it('should return false for folder type', () => {
      // Act & Assert
      expect(isFile('folder')).toBe(false)
    })

    it.each([
      ['file', true],
      ['folder', false],
    ] as const)('isFile(%s) should return %s', (type, expected) => {
      // Act & Assert
      expect(isFile(type)).toBe(expected)
    })
  })

  // ==========================================
  // isBucketListInitiation Tests
  // ==========================================
  describe('isBucketListInitiation', () => {
    it('should return false when bucket is not empty', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: 'my-bucket', files: [], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, [], 'existing-bucket')).toBe(false)
    })

    it('should return false when prefix is not empty', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: 'my-bucket', files: [], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, ['folder1'], '')).toBe(false)
    })

    it('should return false when data items have no bucket', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: '', files: [{ id: '1', name: 'file.txt', size: 1024, type: 'file' }], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, [], '')).toBe(false)
    })

    it('should return true for multiple buckets with no prefix and bucket', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
        { bucket: 'bucket-2', files: [], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, [], '')).toBe(true)
    })

    it('should return true for single bucket with no files, no prefix, and no bucket', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: 'my-bucket', files: [], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, [], '')).toBe(true)
    })

    it('should return false for single bucket with files', () => {
      // Arrange
      const data: OnlineDriveData[] = [
        { bucket: 'my-bucket', files: [{ id: '1', name: 'file.txt', size: 1024, type: 'file' }], is_truncated: false, next_page_parameters: {} },
      ]

      // Act & Assert
      expect(isBucketListInitiation(data, [], '')).toBe(false)
    })

    it('should return false for empty data array', () => {
      // Arrange
      const data: OnlineDriveData[] = []

      // Act & Assert
      expect(isBucketListInitiation(data, [], '')).toBe(false)
    })
  })

  // ==========================================
  // convertOnlineDriveData Tests
  // ==========================================
  describe('convertOnlineDriveData', () => {
    describe('Empty data handling', () => {
      it('should return empty result for empty data array', () => {
        // Arrange
        const data: OnlineDriveData[] = []

        // Act
        const result = convertOnlineDriveData(data, [], '')

        // Assert
        expect(result).toEqual({
          fileList: [],
          isTruncated: false,
          nextPageParameters: {},
          hasBucket: false,
        })
      })
    })

    describe('Bucket list initiation', () => {
      it('should convert multiple buckets to bucket file list', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          { bucket: 'bucket-1', files: [], is_truncated: false, next_page_parameters: {} },
          { bucket: 'bucket-2', files: [], is_truncated: false, next_page_parameters: {} },
          { bucket: 'bucket-3', files: [], is_truncated: false, next_page_parameters: {} },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], '')

        // Assert
        expect(result.fileList).toHaveLength(3)
        expect(result.fileList[0]).toEqual({
          id: 'bucket-1',
          name: 'bucket-1',
          type: OnlineDriveFileType.bucket,
        })
        expect(result.fileList[1]).toEqual({
          id: 'bucket-2',
          name: 'bucket-2',
          type: OnlineDriveFileType.bucket,
        })
        expect(result.fileList[2]).toEqual({
          id: 'bucket-3',
          name: 'bucket-3',
          type: OnlineDriveFileType.bucket,
        })
        expect(result.hasBucket).toBe(true)
        expect(result.isTruncated).toBe(false)
        expect(result.nextPageParameters).toEqual({})
      })

      it('should convert single bucket with no files to bucket list', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          { bucket: 'my-bucket', files: [], is_truncated: false, next_page_parameters: {} },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], '')

        // Assert
        expect(result.fileList).toHaveLength(1)
        expect(result.fileList[0]).toEqual({
          id: 'my-bucket',
          name: 'my-bucket',
          type: OnlineDriveFileType.bucket,
        })
        expect(result.hasBucket).toBe(true)
      })
    })

    describe('File list conversion', () => {
      it('should convert files correctly', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [
              { id: 'file-1', name: 'document.pdf', size: 1024, type: 'file' },
              { id: 'file-2', name: 'image.png', size: 2048, type: 'file' },
            ],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, ['folder1'], 'my-bucket')

        // Assert
        expect(result.fileList).toHaveLength(2)
        expect(result.fileList[0]).toEqual({
          id: 'file-1',
          name: 'document.pdf',
          size: 1024,
          type: OnlineDriveFileType.file,
        })
        expect(result.fileList[1]).toEqual({
          id: 'file-2',
          name: 'image.png',
          size: 2048,
          type: OnlineDriveFileType.file,
        })
        expect(result.hasBucket).toBe(true)
      })

      it('should convert folders correctly without size', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [
              { id: 'folder-1', name: 'Documents', size: 0, type: 'folder' },
              { id: 'folder-2', name: 'Images', size: 0, type: 'folder' },
            ],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.fileList).toHaveLength(2)
        expect(result.fileList[0]).toEqual({
          id: 'folder-1',
          name: 'Documents',
          size: undefined,
          type: OnlineDriveFileType.folder,
        })
        expect(result.fileList[1]).toEqual({
          id: 'folder-2',
          name: 'Images',
          size: undefined,
          type: OnlineDriveFileType.folder,
        })
      })

      it('should handle mixed files and folders', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [
              { id: 'folder-1', name: 'Documents', size: 0, type: 'folder' },
              { id: 'file-1', name: 'readme.txt', size: 256, type: 'file' },
              { id: 'folder-2', name: 'Images', size: 0, type: 'folder' },
              { id: 'file-2', name: 'data.json', size: 512, type: 'file' },
            ],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.fileList).toHaveLength(4)
        expect(result.fileList[0].type).toBe(OnlineDriveFileType.folder)
        expect(result.fileList[1].type).toBe(OnlineDriveFileType.file)
        expect(result.fileList[2].type).toBe(OnlineDriveFileType.folder)
        expect(result.fileList[3].type).toBe(OnlineDriveFileType.file)
      })
    })

    describe('Truncation and pagination', () => {
      it('should return isTruncated true when data is truncated', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: true,
            next_page_parameters: { cursor: 'next-cursor' },
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.isTruncated).toBe(true)
        expect(result.nextPageParameters).toEqual({ cursor: 'next-cursor' })
      })

      it('should return isTruncated false when not truncated', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.isTruncated).toBe(false)
        expect(result.nextPageParameters).toEqual({})
      })

      it('should handle undefined is_truncated', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: undefined as any,
            next_page_parameters: undefined as any,
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.isTruncated).toBe(false)
        expect(result.nextPageParameters).toEqual({})
      })
    })

    describe('hasBucket flag', () => {
      it('should return hasBucket true when bucket exists in data', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.hasBucket).toBe(true)
      })

      it('should return hasBucket false when bucket is empty in data', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: '',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], '')

        // Assert
        expect(result.hasBucket).toBe(false)
      })
    })

    describe('Edge cases', () => {
      it('should handle files with zero size', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'empty.txt', size: 0, type: 'file' }],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.fileList[0].size).toBe(0)
      })

      it('should handle files with very large size', () => {
        // Arrange
        const largeSize = Number.MAX_SAFE_INTEGER
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'large.bin', size: largeSize, type: 'file' }],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.fileList[0].size).toBe(largeSize)
      })

      it('should handle files with special characters in name', () => {
        // Arrange
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [
              { id: 'file-1', name: 'file[1] (copy).txt', size: 1024, type: 'file' },
              { id: 'file-2', name: 'doc-with-dash_and_underscore.pdf', size: 2048, type: 'file' },
              { id: 'file-3', name: 'file with spaces.txt', size: 512, type: 'file' },
            ],
            is_truncated: false,
            next_page_parameters: {},
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.fileList[0].name).toBe('file[1] (copy).txt')
        expect(result.fileList[1].name).toBe('doc-with-dash_and_underscore.pdf')
        expect(result.fileList[2].name).toBe('file with spaces.txt')
      })

      it('should handle complex next_page_parameters', () => {
        // Arrange
        const complexParams = {
          cursor: 'abc123',
          page: 2,
          limit: 50,
          nested: { key: 'value' },
        }
        const data: OnlineDriveData[] = [
          {
            bucket: 'my-bucket',
            files: [{ id: 'file-1', name: 'file.txt', size: 1024, type: 'file' }],
            is_truncated: true,
            next_page_parameters: complexParams,
          },
        ]

        // Act
        const result = convertOnlineDriveData(data, [], 'my-bucket')

        // Assert
        expect(result.nextPageParameters).toEqual(complexParams)
      })
    })
  })
})
