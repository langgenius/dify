import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentSettings from './document-settings'

// Mock next/navigation
const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}))

// Mock use-context-selector
vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useContext: () => ({
      indexingTechnique: 'qualified',
      dataset: { id: 'dataset-1' },
    }),
  }
})

// Mock hooks
const mockInvalidDocumentList = vi.fn()
const mockInvalidDocumentDetail = vi.fn()
let mockDocumentDetail: Record<string, unknown> | null = {
  name: 'test-document',
  data_source_type: 'upload_file',
  data_source_info: {
    upload_file: { id: 'file-1', name: 'test.pdf' },
  },
}
let mockError: Error | null = null

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentDetail: () => ({
    data: mockDocumentDetail,
    error: mockError,
  }),
  useInvalidDocumentList: () => mockInvalidDocumentList,
  useInvalidDocumentDetail: () => mockInvalidDocumentDetail,
}))

// Mock useDefaultModel
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: { model: 'text-embedding-ada-002' },
  }),
}))

// Mock child components
vi.mock('@/app/components/base/app-unavailable', () => ({
  default: ({ code, unknownReason }: { code?: number, unknownReason?: string }) => (
    <div data-testid="app-unavailable">
      <span data-testid="error-code">{code}</span>
      <span data-testid="error-reason">{unknownReason}</span>
    </div>
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: ({ type }: { type?: string }) => (
    <div data-testid="loading" data-type={type}>Loading...</div>
  ),
}))

vi.mock('@/app/components/datasets/create/step-two', () => ({
  default: ({
    isAPIKeySet,
    onSetting,
    datasetId,
    dataSourceType,
    files,
    onSave,
    onCancel,
    isSetting,
  }: {
    isAPIKeySet?: boolean
    onSetting?: () => void
    datasetId?: string
    dataSourceType?: string
    files?: unknown[]
    onSave?: () => void
    onCancel?: () => void
    isSetting?: boolean
  }) => (
    <div data-testid="step-two">
      <span data-testid="api-key-set">{isAPIKeySet ? 'true' : 'false'}</span>
      <span data-testid="dataset-id">{datasetId}</span>
      <span data-testid="data-source-type">{dataSourceType}</span>
      <span data-testid="is-setting">{isSetting ? 'true' : 'false'}</span>
      <span data-testid="files-count">{files?.length || 0}</span>
      <button onClick={onSetting} data-testid="setting-btn">Setting</button>
      <button onClick={onSave} data-testid="save-btn">Save</button>
      <button onClick={onCancel} data-testid="cancel-btn">Cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting', () => ({
  default: ({ activeTab, onCancel }: { activeTab?: string, onCancel?: () => void }) => (
    <div data-testid="account-setting">
      <span data-testid="active-tab">{activeTab}</span>
      <button onClick={onCancel} data-testid="close-setting">Close</button>
    </div>
  ),
}))

describe('DocumentSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentDetail = {
      name: 'test-document',
      data_source_type: 'upload_file',
      data_source_info: {
        upload_file: { id: 'file-1', name: 'test.pdf' },
      },
    }
    mockError = null
  })

  const defaultProps = {
    datasetId: 'dataset-1',
    documentId: 'document-1',
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render StepTwo component when data is loaded', () => {
      // Arrange & Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('step-two')).toBeInTheDocument()
    })

    it('should render loading when documentDetail is not available', () => {
      // Arrange
      mockDocumentDetail = null

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should render AppUnavailable when error occurs', () => {
      // Arrange
      mockError = new Error('Error loading document')

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('app-unavailable')).toBeInTheDocument()
      expect(screen.getByTestId('error-code')).toHaveTextContent('500')
    })
  })

  // Props passing
  describe('Props Passing', () => {
    it('should pass datasetId to StepTwo', () => {
      // Arrange & Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('dataset-id')).toHaveTextContent('dataset-1')
    })

    it('should pass isSetting true to StepTwo', () => {
      // Arrange & Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('is-setting')).toHaveTextContent('true')
    })

    it('should pass isAPIKeySet when embedding model is available', () => {
      // Arrange & Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('api-key-set')).toHaveTextContent('true')
    })

    it('should pass data source type to StepTwo', () => {
      // Arrange & Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('data-source-type')).toHaveTextContent('upload_file')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call router.back when cancel is clicked', () => {
      // Arrange
      render(<DocumentSettings {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByTestId('cancel-btn'))

      // Assert
      expect(mockBack).toHaveBeenCalled()
    })

    it('should navigate to document page when save is clicked', () => {
      // Arrange
      render(<DocumentSettings {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockInvalidDocumentDetail).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/document-1')
    })

    it('should show AccountSetting modal when setting button is clicked', () => {
      // Arrange
      render(<DocumentSettings {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByTestId('setting-btn'))

      // Assert
      expect(screen.getByTestId('account-setting')).toBeInTheDocument()
    })

    it('should hide AccountSetting modal when close is clicked', async () => {
      // Arrange
      render(<DocumentSettings {...defaultProps} />)
      fireEvent.click(screen.getByTestId('setting-btn'))
      expect(screen.getByTestId('account-setting')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByTestId('close-setting'))

      // Assert
      expect(screen.queryByTestId('account-setting')).not.toBeInTheDocument()
    })
  })

  // Data source types
  describe('Data Source Types', () => {
    it('should handle legacy upload_file data source', () => {
      // Arrange
      mockDocumentDetail = {
        name: 'test-document',
        data_source_type: 'upload_file',
        data_source_info: {
          upload_file: { id: 'file-1', name: 'test.pdf' },
        },
      }

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('files-count')).toHaveTextContent('1')
    })

    it('should handle website crawl data source', () => {
      // Arrange
      mockDocumentDetail = {
        name: 'test-website',
        data_source_type: 'website_crawl',
        data_source_info: {
          title: 'Test Page',
          source_url: 'https://example.com',
          content: 'Page content',
          description: 'Page description',
        },
      }

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('data-source-type')).toHaveTextContent('website_crawl')
    })

    it('should handle local file data source', () => {
      // Arrange
      mockDocumentDetail = {
        name: 'local-file',
        data_source_type: 'upload_file',
        data_source_info: {
          related_id: 'file-id',
          transfer_method: 'local',
          name: 'local-file.pdf',
          extension: 'pdf',
        },
      }

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('files-count')).toHaveTextContent('1')
    })

    it('should handle online document (Notion) data source', () => {
      // Arrange
      mockDocumentDetail = {
        name: 'notion-page',
        data_source_type: 'notion_import',
        data_source_info: {
          workspace_id: 'ws-1',
          credential_id: 'cred-1',
          page: {
            page_id: 'page-1',
            page_name: 'Test Page',
            page_icon: '📄',
            type: 'page',
          },
        },
      }

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('data-source-type')).toHaveTextContent('notion_import')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined data_source_info', () => {
      // Arrange
      mockDocumentDetail = {
        name: 'test-document',
        data_source_type: 'upload_file',
        data_source_info: undefined,
      }

      // Act
      render(<DocumentSettings {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('files-count')).toHaveTextContent('0')
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(
        <DocumentSettings datasetId="dataset-1" documentId="doc-1" />,
      )

      // Act
      rerender(<DocumentSettings datasetId="dataset-2" documentId="doc-2" />)

      // Assert
      expect(screen.getByTestId('step-two')).toBeInTheDocument()
    })
  })
})
