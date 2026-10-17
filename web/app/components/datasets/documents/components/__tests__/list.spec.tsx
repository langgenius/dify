import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import DocumentList from '../list'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'dataset.newKnowledge.documentsSelected': '{{count}} documents selected',
  })
})
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: ReturnType<typeof createDatasetFixture> }) => unknown,
  ) => selector({ dataset: createDatasetFixture({ permission_keys: ['dataset.acl.edit'] }) }),
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
const documents: DocumentWithSegmentsResponse[] = ['Guide', 'Reference'].map((name, index) => ({
  id: `doc-${index}`,
  name,
  data_source_type: 'upload_file',
  indexing_status: 'completed',
  enabled: true,
  archived: false,
  display_status: 'available',
  created_at: 1700000000,
  data_source_detail_dict: {
    upload_file: {
      id: `file-${index}`,
      name: `${name}.pdf`,
      extension: 'pdf',
      mime_type: 'application/pdf',
      size: 1024,
      created_at: 1700000000,
      created_by: 'user-1',
    },
  },
}))
const defaultProps = {
  embeddingAvailable: true,
  documents: [] as DocumentWithSegmentsResponse[],
  selectedIds: [] as string[],
  onSelectedIdChange: vi.fn(),
  datasetId: 'ds-1',
  pagination: { total: 0, current: 0, limit: 10, onChange: vi.fn() },
  onUpdate: vi.fn(),
  onManageMetadata: vi.fn(),
  remoteSortValue: '-created_at',
  onSortChange: vi.fn(),
}

describe('DocumentList', () => {
  it('selects real document rows, announces totals and clears selection from the action bar', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [selectedIds, onSelectedIdChange] = useState<string[]>([])
      return (
        <DocumentList
          {...defaultProps}
          documents={documents}
          selectedIds={selectedIds}
          onSelectedIdChange={onSelectedIdChange}
        />
      )
    }
    render(<Harness />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('0 documents selected')
    await user.click(screen.getByRole('checkbox', { name: 'Guide' }))
    expect(status).toHaveTextContent('1 documents selected')
    expect(screen.getByRole('checkbox', { name: 'Reference' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
    expect(status).toHaveTextContent('2 documents selected')
    expect(screen.getByRole('checkbox', { name: 'Reference' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('0 documents selected')
    expect(screen.getByRole('checkbox', { name: 'Guide' })).not.toBeChecked()
    expect(
      screen.queryByRole('button', { name: 'dataset.batchAction.cancel' }),
    ).not.toBeInTheDocument()
  })

  it('exposes sorting only on the current column and updates the requested sort order', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DocumentList {...defaultProps} embeddingAvailable={false} />)
    const uploadedHeader = screen.getByRole('columnheader', {
      name: 'datasetDocuments.list.table.header.uploadTime',
    })
    const hitsHeader = screen.getByRole('columnheader', {
      name: 'datasetDocuments.list.table.header.hitCount',
    })
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'descending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')

    await user.tab()
    expect(
      screen.getByRole('button', { name: 'datasetDocuments.list.table.header.hitCount' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('-hit_count')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="-hit_count" />,
    )
    expect(hitsHeader).toHaveAttribute('aria-sort', 'descending')
    expect(uploadedHeader).not.toHaveAttribute('aria-sort')

    await user.keyboard(' ')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('hit_count')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="hit_count" />,
    )
    expect(hitsHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(uploadedHeader).not.toHaveAttribute('aria-sort')

    await user.click(
      screen.getByRole('button', { name: 'datasetDocuments.list.table.header.uploadTime' }),
    )
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('-created_at')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="-created_at" />,
    )
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'descending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')

    await user.keyboard('{Enter}')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('created_at')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="created_at" />,
    )
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')
  })
  it('opens rename for the selected document row', async () => {
    const user = userEvent.setup()
    render(<DocumentList {...defaultProps} documents={documents} />)
    await user.click(
      screen.getAllByRole('button', { name: 'datasetDocuments.list.table.rename' })[1]!,
    )
    expect(
      await screen.findByRole('dialog', { name: 'datasetDocuments.list.table.rename' }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('Reference')).toBeInTheDocument()
  })
})
