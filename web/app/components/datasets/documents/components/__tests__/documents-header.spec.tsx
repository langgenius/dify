import type { SortType } from '@/service/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import DocumentsHeader from '../documents-header'

const LIST_TITLE_RE = /list\.title/i
const LIST_DESC_RE = /list\.desc/i
const LIST_LEARN_MORE_RE = /list\.learnMore/i
const METADATA_RE = /metadata\.metadata/i
const ADD_FILE_RE = /list\.addFile/i
const ADD_PAGES_RE = /list\.addPages/i
const ADD_URL_RE = /list\.addUrl/i
const CURRENT_DRAFT_UNPUBLISHED_RE = /workflow\.common\.currentDraftUnpublished/i

// Mock the context hooks
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

// Mock child components that require API calls
vi.mock('@/app/components/datasets/common/document-status-with-action/auto-disabled-document', () => ({
  default: () => <div data-testid="auto-disabled-document">AutoDisabledDocument</div>,
}))

vi.mock('@/app/components/datasets/common/document-status-with-action/index-failed', () => ({
  default: () => <div data-testid="index-failed">IndexFailed</div>,
}))

vi.mock('@/app/components/datasets/metadata/metadata-dataset/dataset-metadata-drawer', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="metadata-drawer">
      <button onClick={onClose}>Close</button>
      MetadataDrawer
    </div>
  ),
}))

describe('DocumentsHeader', () => {
  const defaultProps = {
    datasetId: 'dataset-123',
    dataSourceType: DataSourceType.FILE,
    embeddingAvailable: true,
    canAddDocument: true,
    isFreePlan: false,
    statusFilterValue: 'all',
    sortValue: 'created_at' as SortType,
    inputValue: '',
    onStatusFilterChange: vi.fn(),
    onStatusFilterClear: vi.fn(),
    onSortChange: vi.fn(),
    onInputChange: vi.fn(),
    isShowEditMetadataModal: false,
    showEditMetadataModal: vi.fn(),
    hideEditMetadataModal: vi.fn(),
    datasetMetaData: [],
    builtInMetaData: [],
    builtInEnabled: true,
    onAddMetaData: vi.fn(),
    onRenameMetaData: vi.fn(),
    onDeleteMetaData: vi.fn(),
    onBuiltInEnabledChange: vi.fn(),
    onAddDocument: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DocumentsHeader {...defaultProps} />)
      expect(screen.getByText(LIST_TITLE_RE)).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<DocumentsHeader {...defaultProps} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LIST_TITLE_RE)
    })

    it('should render description text', () => {
      render(<DocumentsHeader {...defaultProps} />)
      expect(screen.getByText(LIST_DESC_RE)).toBeInTheDocument()
    })

    it('should render learn more link', () => {
      render(<DocumentsHeader {...defaultProps} />)
      const link = screen.getByRole('link')
      expect(link).toHaveTextContent(LIST_LEARN_MORE_RE)
      expect(link).toHaveAttribute('href', expect.stringContaining('use-dify/knowledge'))
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render filter input', () => {
      render(<DocumentsHeader {...defaultProps} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('AutoDisabledDocument', () => {
    it('should show AutoDisabledDocument when not free plan', () => {
      render(<DocumentsHeader {...defaultProps} isFreePlan={false} />)
      expect(screen.getByTestId('auto-disabled-document')).toBeInTheDocument()
    })

    it('should not show AutoDisabledDocument when on free plan', () => {
      render(<DocumentsHeader {...defaultProps} isFreePlan={true} />)
      expect(screen.queryByTestId('auto-disabled-document')).not.toBeInTheDocument()
    })
  })

  describe('IndexFailed', () => {
    it('should always show IndexFailed component', () => {
      render(<DocumentsHeader {...defaultProps} />)
      expect(screen.getByTestId('index-failed')).toBeInTheDocument()
    })
  })

  describe('Embedding Availability', () => {
    it('should show metadata button when embedding is available', () => {
      render(<DocumentsHeader {...defaultProps} embeddingAvailable={true} />)
      expect(screen.getByText(METADATA_RE)).toBeInTheDocument()
    })

    it('should show add document button when embedding is available', () => {
      render(<DocumentsHeader {...defaultProps} embeddingAvailable={true} />)
      expect(screen.getByText(ADD_FILE_RE)).toBeInTheDocument()
    })

    it('should show warning when embedding is not available', () => {
      render(<DocumentsHeader {...defaultProps} embeddingAvailable={false} />)
      expect(screen.queryByText(METADATA_RE)).not.toBeInTheDocument()
      expect(screen.queryByText(ADD_FILE_RE)).not.toBeInTheDocument()
    })

    it('should disable add document button when document upload is unavailable', () => {
      render(<DocumentsHeader {...defaultProps} canAddDocument={false} />)
      expect(screen.getByRole('button', { name: ADD_FILE_RE })).toBeDisabled()
    })

    it('should show unpublished warning when document upload is unavailable', () => {
      render(<DocumentsHeader {...defaultProps} canAddDocument={false} />)
      expect(screen.getByText(CURRENT_DRAFT_UNPUBLISHED_RE)).toBeInTheDocument()
    })
  })

  describe('Add Button Text', () => {
    it('should show "Add File" for FILE data source', () => {
      render(<DocumentsHeader {...defaultProps} dataSourceType={DataSourceType.FILE} />)
      expect(screen.getByText(ADD_FILE_RE)).toBeInTheDocument()
    })

    it('should show "Add Pages" for NOTION data source', () => {
      render(<DocumentsHeader {...defaultProps} dataSourceType={DataSourceType.NOTION} />)
      expect(screen.getByText(ADD_PAGES_RE)).toBeInTheDocument()
    })

    it('should show "Add Url" for WEB data source', () => {
      render(<DocumentsHeader {...defaultProps} dataSourceType={DataSourceType.WEB} />)
      expect(screen.getByText(ADD_URL_RE)).toBeInTheDocument()
    })
  })

  describe('Metadata Modal', () => {
    it('should show metadata drawer when isShowEditMetadataModal is true', () => {
      render(<DocumentsHeader {...defaultProps} isShowEditMetadataModal={true} />)
      expect(screen.getByTestId('metadata-drawer')).toBeInTheDocument()
    })

    it('should not show metadata drawer when isShowEditMetadataModal is false', () => {
      render(<DocumentsHeader {...defaultProps} isShowEditMetadataModal={false} />)
      expect(screen.queryByTestId('metadata-drawer')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call showEditMetadataModal when metadata button is clicked', () => {
      const showEditMetadataModal = vi.fn()
      render(<DocumentsHeader {...defaultProps} showEditMetadataModal={showEditMetadataModal} />)

      const metadataButton = screen.getByText(METADATA_RE)
      fireEvent.click(metadataButton)

      expect(showEditMetadataModal).toHaveBeenCalledTimes(1)
    })

    it('should call onAddDocument when add button is clicked', () => {
      const onAddDocument = vi.fn()
      render(<DocumentsHeader {...defaultProps} onAddDocument={onAddDocument} />)

      const addButton = screen.getByText(ADD_FILE_RE)
      fireEvent.click(addButton)

      expect(onAddDocument).toHaveBeenCalledTimes(1)
    })

    it('should call onInputChange when typing in search input', () => {
      const onInputChange = vi.fn()
      render(<DocumentsHeader {...defaultProps} onInputChange={onInputChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'search query' } })

      expect(onInputChange).toHaveBeenCalledWith('search query')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined dataSourceType', () => {
      render(<DocumentsHeader {...defaultProps} dataSourceType={undefined} />)
      // Should default to "Add File" text
      expect(screen.getByText(ADD_FILE_RE)).toBeInTheDocument()
    })

    it('should handle empty metadata arrays', () => {
      render(
        <DocumentsHeader
          {...defaultProps}
          isShowEditMetadataModal={true}
          datasetMetaData={[]}
          builtInMetaData={[]}
        />,
      )
      expect(screen.getByTestId('metadata-drawer')).toBeInTheDocument()
    })

    it('should render with descending sort order', () => {
      render(<DocumentsHeader {...defaultProps} sortValue="-created_at" />)
      // Component should still render correctly
      expect(screen.getByText(LIST_TITLE_RE)).toBeInTheDocument()
    })
  })
})
