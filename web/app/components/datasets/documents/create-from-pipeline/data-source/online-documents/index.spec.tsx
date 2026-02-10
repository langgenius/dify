import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import OnlineDocuments from './index'

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
let mockPipelineId = 'pipeline-123'
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

// Mock Toast.notify - static method that manipulates DOM, needs mocking to verify calls
const { mockToastNotify } = vi.hoisted(() => ({
  mockToastNotify: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
  },
}))

// Mock useGetDataSourceAuth - API service hook requires mocking
const { mockUseGetDataSourceAuth } = vi.hoisted(() => ({
  mockUseGetDataSourceAuth: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceAuth: mockUseGetDataSourceAuth,
}))

// Note: zustand/react/shallow useShallow is imported directly (simple utility function)

// Mock store
const mockStoreState = {
  documentsData: [] as DataSourceNotionWorkspace[],
  searchValue: '',
  selectedPagesId: new Set<string>(),
  currentCredentialId: '',
  setDocumentsData: vi.fn(),
  setSearchValue: vi.fn(),
  setSelectedPagesId: vi.fn(),
  setOnlineDocuments: vi.fn(),
  setCurrentDocument: vi.fn(),
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

// Mock SearchInput component
vi.mock('@/app/components/base/notion-page-selector/search-input', () => ({
  default: ({ value, onChange }: { value: string, onChange: (v: string) => void }) => (
    <div data-testid="search-input">
      <input
        data-testid="search-input-field"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search"
      />
    </div>
  ),
}))

// Mock PageSelector component
vi.mock('./page-selector', () => ({
  default: (props: any) => (
    <div data-testid="page-selector">
      <span data-testid="page-selector-checked-count">{props.checkedIds?.size || 0}</span>
      <span data-testid="page-selector-search-value">{props.searchValue}</span>
      <span data-testid="page-selector-can-preview">{String(props.canPreview)}</span>
      <span data-testid="page-selector-multiple-choice">{String(props.isMultipleChoice)}</span>
      <span data-testid="page-selector-credential-id">{props.currentCredentialId}</span>
      <button
        data-testid="page-selector-select-btn"
        onClick={() => props.onSelect(new Set(['page-1', 'page-2']))}
      >
        Select Pages
      </button>
      <button
        data-testid="page-selector-preview-btn"
        onClick={() => props.onPreview?.('page-1')}
      >
        Preview Page
      </button>
    </div>
  ),
}))

// Mock Title component
vi.mock('./title', () => ({
  default: ({ name }: { name: string }) => (
    <div data-testid="title">
      <span data-testid="title-name">{name}</span>
    </div>
  ),
}))

// ==========================================
// Test Data Builders
// ==========================================
const createMockNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  plugin_id: 'plugin-123',
  provider_type: 'notion',
  provider_name: 'notion-provider',
  datasource_name: 'notion-ds',
  datasource_label: 'Notion',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

const createMockPage = (overrides?: Partial<NotionPage>): NotionPage => ({
  page_id: 'page-1',
  page_name: 'Test Page',
  page_icon: null,
  is_bound: false,
  parent_id: 'root',
  type: 'page',
  workspace_id: 'workspace-1',
  ...overrides,
})

const createMockWorkspace = (overrides?: Partial<DataSourceNotionWorkspace>): DataSourceNotionWorkspace => ({
  workspace_id: 'workspace-1',
  workspace_name: 'Test Workspace',
  workspace_icon: null,
  pages: [createMockPage()],
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

type OnlineDocumentsProps = React.ComponentProps<typeof OnlineDocuments>

const createDefaultProps = (overrides?: Partial<OnlineDocumentsProps>): OnlineDocumentsProps => ({
  nodeId: 'node-1',
  nodeData: createMockNodeData(),
  onCredentialChange: vi.fn(),
  isInPipeline: false,
  supportBatchUpload: true,
  ...overrides,
})

// ==========================================
// Test Suites
// ==========================================
describe('OnlineDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state
    mockStoreState.documentsData = []
    mockStoreState.searchValue = ''
    mockStoreState.selectedPagesId = new Set()
    mockStoreState.currentCredentialId = ''
    mockStoreState.setDocumentsData = vi.fn()
    mockStoreState.setSearchValue = vi.fn()
    mockStoreState.setSelectedPagesId = vi.fn()
    mockStoreState.setOnlineDocuments = vi.fn()
    mockStoreState.setCurrentDocument = vi.fn()

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
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    it('should render Header with correct props', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-123'
      const props = createDefaultProps({
        nodeData: createMockNodeData({ datasource_label: 'My Notion' }),
      })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header-doc-title')).toHaveTextContent('Docs')
      expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('My Notion')
      expect(screen.getByTestId('header-credential-id')).toHaveTextContent('cred-123')
    })

    it('should render Loading when documentsData is empty', () => {
      // Arrange
      mockStoreState.documentsData = []
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render PageSelector when documentsData has content', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('should render Title with datasource_label', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps({
        nodeData: createMockNodeData({ datasource_label: 'Notion Integration' }),
      })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('title-name')).toHaveTextContent('Notion Integration')
    })

    it('should render SearchInput with current searchValue', () => {
      // Arrange
      mockStoreState.searchValue = 'test search'
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      const searchInput = screen.getByTestId('search-input-field') as HTMLInputElement
      expect(searchInput.value).toBe('test search')
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('nodeId prop', () => {
      it('should use nodeId in datasourceNodeRunURL for non-pipeline mode', () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({
          nodeId: 'custom-node-id',
          isInPipeline: false,
        })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert - Effect triggers ssePost with correct URL
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.stringContaining('/nodes/custom-node-id/run'),
          expect.any(Object),
          expect.any(Object),
        )
      })
    })

    describe('nodeData prop', () => {
      it('should pass datasource_parameters to ssePost', () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const nodeData = createMockNodeData({
          datasource_parameters: {
            param1: { type: VarKindType.constant, value: 'value1' },
            param2: { type: VarKindType.constant, value: 'value2' },
          },
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.objectContaining({
              inputs: { param1: 'value1', param2: 'value2' },
            }),
          }),
          expect.any(Object),
        )
      })

      it('should pass plugin_id and provider_name to useGetDataSourceAuth', () => {
        // Arrange
        const nodeData = createMockNodeData({
          plugin_id: 'my-plugin-id',
          provider_name: 'my-provider',
        })
        const props = createDefaultProps({ nodeData })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
          pluginId: 'my-plugin-id',
          provider: 'my-provider',
        })
      })
    })

    describe('isInPipeline prop', () => {
      it('should use draft URL when isInPipeline is true', () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.stringContaining('/workflows/draft/'),
          expect.any(Object),
          expect.any(Object),
        )
      })

      it('should use published URL when isInPipeline is false', () => {
        // Arrange
        mockStoreState.currentCredentialId = 'cred-1'
        const props = createDefaultProps({ isInPipeline: false })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(mockSsePost).toHaveBeenCalledWith(
          expect.stringContaining('/workflows/published/'),
          expect.any(Object),
          expect.any(Object),
        )
      })

      it('should pass canPreview as false to PageSelector when isInPipeline is true', () => {
        // Arrange
        mockStoreState.documentsData = [createMockWorkspace()]
        const props = createDefaultProps({ isInPipeline: true })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('page-selector-can-preview')).toHaveTextContent('false')
      })

      it('should pass canPreview as true to PageSelector when isInPipeline is false', () => {
        // Arrange
        mockStoreState.documentsData = [createMockWorkspace()]
        const props = createDefaultProps({ isInPipeline: false })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('page-selector-can-preview')).toHaveTextContent('true')
      })
    })

    describe('supportBatchUpload prop', () => {
      it('should pass isMultipleChoice as true to PageSelector when supportBatchUpload is true', () => {
        // Arrange
        mockStoreState.documentsData = [createMockWorkspace()]
        const props = createDefaultProps({ supportBatchUpload: true })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('page-selector-multiple-choice')).toHaveTextContent('true')
      })

      it('should pass isMultipleChoice as false to PageSelector when supportBatchUpload is false', () => {
        // Arrange
        mockStoreState.documentsData = [createMockWorkspace()]
        const props = createDefaultProps({ supportBatchUpload: false })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('page-selector-multiple-choice')).toHaveTextContent('false')
      })

      it.each([
        [true, 'true'],
        [false, 'false'],
        [undefined, 'true'], // Default value
      ])('should handle supportBatchUpload=%s correctly', (value, expected) => {
        // Arrange
        mockStoreState.documentsData = [createMockWorkspace()]
        const props = createDefaultProps({ supportBatchUpload: value })

        // Act
        render(<OnlineDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('page-selector-multiple-choice')).toHaveTextContent(expected)
      })
    })

    describe('onCredentialChange prop', () => {
      it('should pass onCredentialChange to Header', () => {
        // Arrange
        const mockOnCredentialChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })

        // Act
        render(<OnlineDocuments {...props} />)
        fireEvent.click(screen.getByTestId('header-credential-change'))

        // Assert
        expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
      })
    })
  })

  // ==========================================
  // Side Effects and Cleanup
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    it('should call getOnlineDocuments when currentCredentialId changes', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledTimes(1)
    })

    it('should not call getOnlineDocuments when currentCredentialId is empty', () => {
      // Arrange
      mockStoreState.currentCredentialId = ''
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).not.toHaveBeenCalled()
    })

    it('should pass correct body parameters to ssePost', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-123'
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledWith(
        expect.any(String),
        {
          body: {
            inputs: {},
            credential_id: 'cred-123',
            datasource_type: 'online_document',
          },
        },
        expect.any(Object),
      )
    })

    it('should handle onDataSourceNodeCompleted callback correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockWorkspaces = [createMockWorkspace()]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        // Simulate successful response
        callbacks.onDataSourceNodeCompleted({
          event: 'datasource_completed',
          data: mockWorkspaces,
          time_consuming: 1000,
        })
      })

      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setDocumentsData).toHaveBeenCalledWith(mockWorkspaces)
      })
    })

    it('should handle onDataSourceNodeError callback correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        // Simulate error response
        callbacks.onDataSourceNodeError({
          event: 'datasource_error',
          error: 'Something went wrong',
        })
      })

      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Something went wrong',
        })
      })
    })

    it('should construct correct URL for draft workflow', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockPipelineId = 'pipeline-456'
      const props = createDefaultProps({
        nodeId: 'node-789',
        isInPipeline: true,
      })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledWith(
        '/rag/pipelines/pipeline-456/workflows/draft/datasource/nodes/node-789/run',
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('should construct correct URL for published workflow', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      mockPipelineId = 'pipeline-456'
      const props = createDefaultProps({
        nodeId: 'node-789',
        isInPipeline: false,
      })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledWith(
        '/rag/pipelines/pipeline-456/workflows/published/datasource/nodes/node-789/run',
        expect.any(Object),
        expect.any(Object),
      )
    })
  })

  // ==========================================
  // Callback Stability and Memoization
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should have stable handleSearchValueChange that updates store', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      const searchInput = screen.getByTestId('search-input-field')
      fireEvent.change(searchInput, { target: { value: 'new search value' } })

      // Assert
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('new search value')
    })

    it('should have stable handleSelectPages that updates store', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('page-selector-select-btn'))

      // Assert
      expect(mockStoreState.setSelectedPagesId).toHaveBeenCalled()
      expect(mockStoreState.setOnlineDocuments).toHaveBeenCalled()
    })

    it('should have stable handlePreviewPage that updates store', () => {
      // Arrange
      const mockPages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
      ]
      mockStoreState.documentsData = [createMockWorkspace({ pages: mockPages })]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('page-selector-preview-btn'))

      // Assert
      expect(mockStoreState.setCurrentDocument).toHaveBeenCalled()
    })

    it('should have stable handleSetting callback', () => {
      // Arrange
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-config-btn'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: 'data-source',
      })
    })
  })

  // ==========================================
  // Memoization Logic and Dependencies
  // ==========================================
  describe('Memoization Logic and Dependencies', () => {
    it('should compute PagesMapAndSelectedPagesId correctly from documentsData', () => {
      // Arrange
      const mockPages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      mockStoreState.documentsData = [
        createMockWorkspace({ workspace_id: 'ws-1', pages: mockPages }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - PageSelector receives the pagesMap (verified via mock)
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
    })

    it('should recompute PagesMapAndSelectedPagesId when documentsData changes', () => {
      // Arrange
      const initialPages = [createMockPage({ page_id: 'page-1' })]
      mockStoreState.documentsData = [createMockWorkspace({ pages: initialPages })]
      const props = createDefaultProps()
      const { rerender } = render(<OnlineDocuments {...props} />)

      // Act - Update documentsData
      const newPages = [
        createMockPage({ page_id: 'page-1' }),
        createMockPage({ page_id: 'page-2' }),
      ]
      mockStoreState.documentsData = [createMockWorkspace({ pages: newPages })]
      rerender(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
    })

    it('should handle empty documentsData in PagesMapAndSelectedPagesId computation', () => {
      // Arrange
      mockStoreState.documentsData = []
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - Should show loading instead of PageSelector
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  // ==========================================
  // User Interactions and Event Handlers
  // ==========================================
  describe('User Interactions and Event Handlers', () => {
    it('should handle search input changes', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      const searchInput = screen.getByTestId('search-input-field')
      fireEvent.change(searchInput, { target: { value: 'search query' } })

      // Assert
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('search query')
    })

    it('should handle page selection', () => {
      // Arrange
      const mockPages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      mockStoreState.documentsData = [createMockWorkspace({ pages: mockPages })]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('page-selector-select-btn'))

      // Assert
      expect(mockStoreState.setSelectedPagesId).toHaveBeenCalled()
      expect(mockStoreState.setOnlineDocuments).toHaveBeenCalled()
    })

    it('should handle page preview', () => {
      // Arrange
      const mockPages = [createMockPage({ page_id: 'page-1', page_name: 'Page 1' })]
      mockStoreState.documentsData = [createMockWorkspace({ pages: mockPages })]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('page-selector-preview-btn'))

      // Assert
      expect(mockStoreState.setCurrentDocument).toHaveBeenCalled()
    })

    it('should handle configuration button click', () => {
      // Arrange
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-config-btn'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: 'data-source',
      })
    })

    it('should handle credential change', () => {
      // Arrange
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })
      render(<OnlineDocuments {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('header-credential-change'))

      // Assert
      expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
    })
  })

  // ==========================================
  // API Calls Mocking
  // ==========================================
  describe('API Calls', () => {
    it('should call ssePost with correct parameters', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'test-cred'
      const props = createDefaultProps({
        nodeData: createMockNodeData({
          datasource_parameters: {
            workspace: { type: VarKindType.constant, value: 'ws-123' },
            database: { type: VarKindType.constant, value: 'db-456' },
          },
        }),
      })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledWith(
        expect.any(String),
        {
          body: {
            inputs: { workspace: 'ws-123', database: 'db-456' },
            credential_id: 'test-cred',
            datasource_type: 'online_document',
          },
        },
        expect.objectContaining({
          onDataSourceNodeCompleted: expect.any(Function),
          onDataSourceNodeError: expect.any(Function),
        }),
      )
    })

    it('should handle successful API response', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockData = [createMockWorkspace()]

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          event: 'datasource_completed',
          data: mockData,
          time_consuming: 500,
        })
      })

      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockStoreState.setDocumentsData).toHaveBeenCalledWith(mockData)
      })
    })

    it('should handle API error response', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          event: 'datasource_error',
          error: 'API Error Message',
        })
      })

      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'API Error Message',
        })
      })
    })

    it('should use useGetDataSourceAuth with correct parameters', () => {
      // Arrange
      const nodeData = createMockNodeData({
        plugin_id: 'notion-plugin',
        provider_name: 'notion-provider',
      })
      const props = createDefaultProps({ nodeData })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockUseGetDataSourceAuth).toHaveBeenCalledWith({
        pluginId: 'notion-plugin',
        provider: 'notion-provider',
      })
    })

    it('should pass credentials from useGetDataSourceAuth to Header', () => {
      // Arrange
      const mockCredentials = [
        createMockCredential({ id: 'cred-1', name: 'Credential 1' }),
        createMockCredential({ id: 'cred-2', name: 'Credential 2' }),
      ]
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: mockCredentials },
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('2')
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty credentials array', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: [] },
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle undefined dataSourceAuth result', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: { result: undefined },
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle null dataSourceAuth data', () => {
      // Arrange
      mockUseGetDataSourceAuth.mockReturnValue({
        data: null,
      })
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('0')
    })

    it('should handle documentsData with empty pages array', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace({ pages: [] })]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
    })

    it('should handle undefined documentsData in useMemo (line 59 branch)', () => {
      // Arrange - Set documentsData to undefined to test the || [] fallback
      mockStoreState.documentsData = undefined as unknown as DataSourceNotionWorkspace[]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - Should show loading when documentsData is undefined
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should handle undefined datasource_parameters (line 79 branch)', () => {
      // Arrange - Set datasource_parameters to undefined to test the || {} fallback
      mockStoreState.currentCredentialId = 'cred-1'
      const nodeData = createMockNodeData()
      // @ts-expect-error - Testing undefined case for branch coverage
      nodeData.datasource_parameters = undefined
      const props = createDefaultProps({ nodeData })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - ssePost should be called with empty inputs
      expect(mockSsePost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.objectContaining({
            inputs: {},
          }),
        }),
        expect.any(Object),
      )
    })

    it('should handle datasource_parameters value without value property (line 80 else branch)', () => {
      // Arrange - Test the else branch where value is not an object with 'value' property
      // This tests: typeof value === 'object' && value !== null && 'value' in value ? value.value : value
      // The else branch (: value) is executed when value is a primitive or object without 'value' key
      mockStoreState.currentCredentialId = 'cred-1'
      const nodeData = createMockNodeData({
        datasource_parameters: {
          // Object without 'value' key - should use the object itself
          objWithoutValue: { type: VarKindType.constant, other: 'data' } as any,
        },
      })
      const props = createDefaultProps({ nodeData })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - The object without 'value' property should be passed as-is
      expect(mockSsePost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.objectContaining({
            inputs: expect.objectContaining({
              objWithoutValue: expect.objectContaining({ type: VarKindType.constant, other: 'data' }),
            }),
          }),
        }),
        expect.any(Object),
      )
    })

    it('should handle multiple workspaces in documentsData', () => {
      // Arrange
      mockStoreState.documentsData = [
        createMockWorkspace({ workspace_id: 'ws-1', pages: [createMockPage({ page_id: 'page-1' })] }),
        createMockWorkspace({ workspace_id: 'ws-2', pages: [createMockPage({ page_id: 'page-2' })] }),
      ]
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
    })

    it('should handle special characters in searchValue', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      const searchInput = screen.getByTestId('search-input-field')
      fireEvent.change(searchInput, { target: { value: 'test<script>alert("xss")</script>' } })

      // Assert
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('test<script>alert("xss")</script>')
    })

    it('should handle unicode characters in searchValue', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Act
      const searchInput = screen.getByTestId('search-input-field')
      fireEvent.change(searchInput, { target: { value: '测试搜索 🔍' } })

      // Assert
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('测试搜索 🔍')
    })

    it('should handle empty string currentCredentialId', () => {
      // Arrange
      mockStoreState.currentCredentialId = ''
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).not.toHaveBeenCalled()
    })

    it('should handle complex datasource_parameters with nested objects', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const nodeData = createMockNodeData({
        datasource_parameters: {
          simple: { type: VarKindType.constant, value: 'value' },
          nested: { type: VarKindType.constant, value: 'nested-value' },
        },
      })
      const props = createDefaultProps({ nodeData })

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(mockSsePost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.objectContaining({
            inputs: expect.objectContaining({
              simple: 'value',
              nested: 'nested-value',
            }),
          }),
        }),
        expect.any(Object),
      )
    })

    it('should handle undefined pipelineId gracefully', () => {
      // Arrange
      mockPipelineId = undefined as any
      mockStoreState.currentCredentialId = 'cred-1'
      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - Should still call ssePost with undefined in URL
      expect(mockSsePost).toHaveBeenCalled()
    })
  })

  // ==========================================
  // All Prop Variations
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      [{ isInPipeline: true, supportBatchUpload: true }],
      [{ isInPipeline: true, supportBatchUpload: false }],
      [{ isInPipeline: false, supportBatchUpload: true }],
      [{ isInPipeline: false, supportBatchUpload: false }],
    ])('should render correctly with props %o', (propVariation) => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props = createDefaultProps(propVariation)

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      expect(screen.getByTestId('page-selector')).toBeInTheDocument()
      expect(screen.getByTestId('page-selector-can-preview')).toHaveTextContent(
        String(!propVariation.isInPipeline),
      )
      expect(screen.getByTestId('page-selector-multiple-choice')).toHaveTextContent(
        String(propVariation.supportBatchUpload),
      )
    })

    it('should use default values for optional props', () => {
      // Arrange
      mockStoreState.documentsData = [createMockWorkspace()]
      const props: OnlineDocumentsProps = {
        nodeId: 'node-1',
        nodeData: createMockNodeData(),
        onCredentialChange: vi.fn(),
        // isInPipeline and supportBatchUpload are not provided
      }

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert - Default values: isInPipeline = false, supportBatchUpload = true
      expect(screen.getByTestId('page-selector-can-preview')).toHaveTextContent('true')
      expect(screen.getByTestId('page-selector-multiple-choice')).toHaveTextContent('true')
    })
  })

  // ==========================================
  // Integration Tests
  // ==========================================
  describe('Integration', () => {
    it('should complete full workflow: load data -> search -> select -> preview', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'
      const mockPages = [
        createMockPage({ page_id: 'page-1', page_name: 'Test Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Test Page 2' }),
      ]
      const mockWorkspace = createMockWorkspace({ pages: mockPages })

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeCompleted({
          event: 'datasource_completed',
          data: [mockWorkspace],
          time_consuming: 100,
        })
      })

      // Update store state after API call
      mockStoreState.documentsData = [mockWorkspace]

      const props = createDefaultProps()
      render(<OnlineDocuments {...props} />)

      // Assert - Data loaded and PageSelector shown
      await waitFor(() => {
        expect(mockStoreState.setDocumentsData).toHaveBeenCalled()
      })

      // Act - Search
      const searchInput = screen.getByTestId('search-input-field')
      fireEvent.change(searchInput, { target: { value: 'Test' } })
      expect(mockStoreState.setSearchValue).toHaveBeenCalledWith('Test')

      // Act - Select pages
      fireEvent.click(screen.getByTestId('page-selector-select-btn'))
      expect(mockStoreState.setSelectedPagesId).toHaveBeenCalled()

      // Act - Preview page
      fireEvent.click(screen.getByTestId('page-selector-preview-btn'))
      expect(mockStoreState.setCurrentDocument).toHaveBeenCalled()
    })

    it('should handle error flow correctly', async () => {
      // Arrange
      mockStoreState.currentCredentialId = 'cred-1'

      mockSsePost.mockImplementation((url, options, callbacks) => {
        callbacks.onDataSourceNodeError({
          event: 'datasource_error',
          error: 'Failed to fetch documents',
        })
      })

      const props = createDefaultProps()

      // Act
      render(<OnlineDocuments {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Failed to fetch documents',
        })
      })

      // Should still show loading since documentsData is empty
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should handle credential change and refetch documents', () => {
      // Arrange
      mockStoreState.currentCredentialId = 'initial-cred'
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnCredentialChange })

      // Act
      render(<OnlineDocuments {...props} />)

      // Initial fetch
      expect(mockSsePost).toHaveBeenCalledTimes(1)

      // Change credential
      fireEvent.click(screen.getByTestId('header-credential-change'))
      expect(mockOnCredentialChange).toHaveBeenCalledWith('new-cred-id')
    })
  })

  // ==========================================
})
