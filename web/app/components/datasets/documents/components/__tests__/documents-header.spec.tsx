import type { SortType } from '@/service/datasets'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceType } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import DocumentsHeader from '../documents-header'

// Mock the context hooks

// Mock child components that require API calls
vi.mock(
  '@/app/components/datasets/common/document-status-with-action/auto-disabled-document',
  () => ({
    default: () => <div data-testid="auto-disabled-document">AutoDisabledDocument</div>,
  }),
)

vi.mock('@/app/components/datasets/common/document-status-with-action/index-failed', () => ({
  default: () => <div data-testid="index-failed">IndexFailed</div>,
}))

describe('DocumentsHeader', () => {
  const defaultProps = {
    datasetId: 'dataset-123',
    dataSourceType: DataSourceType.FILE,
    embeddingAvailable: true,
    canManageMetadata: true,
    canAddDocument: true,
    canEditDocument: true,
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

  it('withholds mutations when permissions are omitted', () => {
    render(
      <DocumentsHeader
        {...defaultProps}
        canManageMetadata={undefined}
        canAddDocument={undefined}
        canEditDocument={undefined}
      />,
    )
    expect(screen.queryByTestId('auto-disabled-document')).not.toBeInTheDocument()
    expect(screen.queryByTestId('index-failed')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.metadata.metadata' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'datasetDocuments.list.addFile' }),
    ).not.toBeInTheDocument()
  })

  it('shows index recovery only with document edit permission', () => {
    const { rerender } = render(<DocumentsHeader {...defaultProps} />)
    expect(screen.getByTestId('auto-disabled-document')).toBeInTheDocument()
    expect(screen.getByTestId('index-failed')).toBeInTheDocument()
    rerender(<DocumentsHeader {...defaultProps} canEditDocument={false} />)
    expect(screen.queryByTestId('auto-disabled-document')).not.toBeInTheDocument()
    expect(screen.queryByTestId('index-failed')).not.toBeInTheDocument()
  })

  it('replaces metadata and import actions with an unavailable embedding warning', () => {
    render(<DocumentsHeader {...defaultProps} embeddingAvailable={false} />)
    expect(screen.getByText('dataset.embeddingModelNotAvailable')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.metadata.metadata' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'datasetDocuments.list.addFile' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [DataSourceType.FILE, 'addFile'],
    [DataSourceType.NOTION, 'addPages'],
    [DataSourceType.WEB, 'addUrl'],
  ] as const)('offers the matching import action for %s', async (dataSourceType, action) => {
    const user = userEvent.setup()
    render(<DocumentsHeader {...defaultProps} dataSourceType={dataSourceType} />)
    await user.click(screen.getByRole('button', { name: `datasetDocuments.list.${action}` }))
    expect(defaultProps.onAddDocument).toHaveBeenCalledOnce()
  })

  it('opens metadata management from its action', async () => {
    const user = userEvent.setup()
    render(<DocumentsHeader {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.metadata' }))
    expect(defaultProps.showEditMetadataModal).toHaveBeenCalledOnce()
  })

  it('keeps the status label stable while selecting a filter', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DocumentsHeader {...defaultProps} />)
    const filter = screen.getByRole('combobox', {
      name: 'datasetDocuments.list.table.header.status',
    })
    expect(filter).toHaveTextContent('datasetDocuments.list.index.all')
    await user.click(filter)
    await user.click(
      await screen.findByRole('option', { name: 'datasetDocuments.list.status.available' }),
    )
    expect(defaultProps.onStatusFilterChange).toHaveBeenCalledWith('available')
    rerender(<DocumentsHeader {...defaultProps} statusFilterValue="available" />)
    expect(
      screen.getByRole('combobox', { name: 'datasetDocuments.list.table.header.status' }),
    ).toHaveTextContent('datasetDocuments.list.status.available')
  })
})
