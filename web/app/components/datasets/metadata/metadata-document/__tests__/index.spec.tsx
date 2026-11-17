import type { DocumentDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DataType } from '../../types'
import MetadataDocument from '../index'

const fields = [
  { id: '1', name: 'title', type: DataType.string, value: 'Original' },
  { id: '2', name: 'score', type: DataType.number, value: 42 },
]
const builtin = { id: 'built-in', name: 'created_at', type: DataType.time, value: 1609459200 }
const state = { embeddingAvailable: true, metadata: [...fields, builtin], builtInEnabled: true }
const save = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.get': async () => ({
        id: 'doc-1',
        doc_metadata: state.metadata,
      }),
      'datasets.byDatasetId.metadata.get': async () => ({
        built_in_field_enabled: state.builtInEnabled,
        doc_metadata: [],
      }),
      'datasets.byDatasetId.documents.metadata.post': (input) => save(input),
    }),
  }
})
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: () => ({ dataset: { embedding_available: state.embeddingAvailable } }),
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (value: number) => `formatted-${value}` }),
}))

const docDetail: DocumentDetailResponse = {
  id: 'doc-1',
  name: 'Guide.txt',
  data_source_type: 'upload_file',
  hit_count: 5,
  segment_count: 10,
}
const props = { datasetId: 'ds-1', documentId: 'doc-1', docDetail }
beforeEach(() => {
  state.embeddingAvailable = true
  state.metadata = [...fields, builtin]
  state.builtInEnabled = true
  save.mockReset().mockResolvedValue({ result: 'success' })
})

describe('Document metadata', () => {
  it('edits and removes custom metadata while keeping builtin fields readonly', async () => {
    const user = userEvent.setup()
    render(<MetadataDocument {...props} canEdit />)
    expect(await screen.findByText('Original')).toBeInTheDocument()
    expect(await screen.findByText('formatted-1609459200')).toBeInTheDocument()
    expect(screen.getByText('Guide.txt')).toBeInTheDocument()
    expect(screen.getByText('50.00% (5/10)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const title = screen.getByRole('textbox', { name: 'title' })
    await user.clear(title)
    await user.type(title, 'Updated')
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
    expect(screen.queryByRole('textbox', { name: 'score' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'created_at' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1' },
        body: {
          operation_data: [
            { document_id: 'doc-1', metadata_list: [{ ...fields[0], value: 'Updated' }] },
          ],
        },
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'common.operation.save' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('discards the draft when canceled and restores it from loaded data when reopened', async () => {
    const user = userEvent.setup()
    render(<MetadataDocument {...props} canEdit />)
    await screen.findByText('Original')
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.type(screen.getByRole('textbox', { name: 'title' }), ' draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByRole('textbox', { name: 'title' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox', { name: 'title' })).toHaveValue('Original')
    expect(save).not.toHaveBeenCalled()
  })

  it.each([undefined, false, true])(
    'gates editing on the explicit ACL grant (%s)',
    async (canEdit) => {
      render(<MetadataDocument {...props} canEdit={canEdit} />)
      await screen.findByText('Original')
      const edit = screen.queryByRole('button', { name: 'common.operation.edit' })
      if (canEdit) expect(edit).toBeInTheDocument()
      else expect(edit).not.toBeInTheDocument()
    },
  )

  it('withholds editing when embeddings are unavailable', async () => {
    state.embeddingAvailable = false
    render(<MetadataDocument {...props} canEdit />)
    await screen.findByText('Original')
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  })

  it('opens an empty metadata editor from the labeling prompt', async () => {
    const user = userEvent.setup()
    state.metadata = []
    state.builtInEnabled = false
    render(<MetadataDocument {...props} canEdit />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })).toBeInTheDocument()
  })
})
