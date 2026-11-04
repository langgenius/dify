import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ParentMode } from '@/models/datasets'
import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DocumentContext } from '../../context'
import Completed from '../index'

const childChunk: ChildChunkResponse = {
  id: 'child-1',
  segment_id: 'segment-1',
  position: 1,
  content: 'Child chunk content',
  word_count: 19,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
}

const segment: SegmentResponse = {
  id: 'segment-1',
  document_id: 'document-1',
  position: 1,
  content: 'Chunk content',
  sign_content: '',
  word_count: 13,
  tokens: 3,
  keywords: [],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 0,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000000,
  completed_at: 1700000000,
  error: null,
  stopped_at: 0,
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [childChunk],
}

let parentMode: ParentMode = 'paragraph'
const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.get>(),
  switch:
    vi.fn<
      typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.segment.byAction.patch
    >(),
  remove: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.delete>(),
  update:
    vi.fn<
      typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.patch
    >(),
  children:
    vi.fn<
      typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get
    >(),
  removeChild: vi.fn(),
  updateChild: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createFileUploadConfigFixture } = await import('@/test/fixtures/file-upload-config')
  const prefix = 'datasets.byDatasetId.documents.byDocumentId.'
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => createFileUploadConfigFixture(),
      [`${prefix}segments.get`]: api.list,
      [`${prefix}segment.byAction.patch`]: api.switch,
      [`${prefix}segments.delete`]: api.remove,
      [`${prefix}segments.bySegmentId.patch`]: api.update,
      [`${prefix}segments.bySegmentId.childChunks.get`]: api.children,
      [`${prefix}segments.bySegmentId.childChunks.byChildChunkId.delete`]: api.removeChild,
      [`${prefix}segments.bySegmentId.childChunks.byChildChunkId.patch`]: api.updateChild,
    }),
  }
})
let serverSegments: SegmentResponse[]

async function renderChunks(canEdit: boolean, docForm: ChunkingMode = ChunkingMode.text) {
  const view = render(
    <EventEmitterContextProvider>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- Dataset detail uses use-context-selector. */}
      <DatasetDetailContext.Provider value={{ dataset: createDatasetFixture({ id: 'dataset-1' }) }}>
        {/* oxlint-disable-next-line eslint-react/no-context-provider -- Document context uses use-context-selector. */}
        <DocumentContext.Provider
          value={{ datasetId: 'dataset-1', documentId: 'document-1', docForm, parentMode, canEdit }}
        >
          <Completed
            embeddingAvailable
            showNewSegmentModal={false}
            onNewSegmentModalChange={vi.fn()}
            importStatus={undefined}
          />
        </DocumentContext.Provider>
      </DatasetDetailContext.Provider>
    </EventEmitterContextProvider>,
  )
  await screen.findByText(parentMode === 'full-doc' ? 'Child chunk content' : 'Chunk content')
  return view
}

describe('Chunk permissions', () => {
  beforeEach(() => {
    serverSegments = [{ ...segment }]
    api.list.mockImplementation(async () => ({
      data: serverSegments,
      total: serverSegments.length,
      total_pages: 1,
      page: 1,
      limit: 10,
      has_more: false,
    }))
    api.children.mockResolvedValue({
      data: [childChunk],
      total: 1,
      total_pages: 1,
      page: 1,
      limit: 10,
    })
    api.switch.mockResolvedValue({ result: 'success' })
    api.remove.mockImplementation(async () => {
      serverSegments = []
      return { result: 'success' }
    })
    api.update.mockImplementation(async ({ body }) => ({
      data: { ...segment, ...body },
      doc_form: ChunkingMode.text,
    }))
    parentMode = 'paragraph'
  })

  it('should pass read-only permission to the batch actions and allow cancelling selection', async () => {
    const user = userEvent.setup()
    await renderChunks(false)

    const checkbox = screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' })
    await user.click(checkbox)

    for (const action of ['enable', 'disable', 'delete']) {
      const button = screen.getByRole('button', { name: `dataset.batchAction.${action}` })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(api.switch).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
    expect(checkbox).not.toBeChecked()
    expect(
      screen.queryByRole('button', { name: 'dataset.batchAction.enable' }),
    ).not.toBeInTheDocument()
  })

  it('should allow batch mutations with edit permission', async () => {
    const user = userEvent.setup()
    serverSegments = [{ ...segment, enabled: false }]
    await renderChunks(true)
    await user.click(screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' }))

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.enable' }))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(api.switch).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1', document_id: 'document-1', action: 'enable' },
      query: { segment_id: ['segment-1'] },
    })
    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.disable' }))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    expect(api.switch).toHaveBeenLastCalledWith({
      params: { dataset_id: 'dataset-1', document_id: 'document-1', action: 'disable' },
      query: { segment_id: ['segment-1'] },
    })

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.sure' }))
    await waitFor(() => expect(screen.queryByText('Chunk content')).not.toBeInTheDocument())
    expect(api.remove).toHaveBeenCalledExactlyOnceWith({
      params: { dataset_id: 'dataset-1', document_id: 'document-1' },
      query: { segment_id: ['segment-1'] },
    })
    expect(
      screen.queryByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' }),
    ).not.toBeInTheDocument()
  })

  it.each([ChunkingMode.text, ChunkingMode.qa, ChunkingMode.parentChild])(
    'should open %s chunk content in read-only mode without edit permission',
    async (docForm) => {
      const user = userEvent.setup()
      await renderChunks(false, docForm)
      await user.click(screen.getByText('Chunk content'))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('datasetDocuments.segment.chunkDetail')).toBeInTheDocument()
      if (docForm === ChunkingMode.qa)
        expect(within(dialog).getByDisplayValue('Chunk content')).toBeDisabled()
      else expect(within(dialog).getByText('Chunk content')).toBeInTheDocument()

      for (const input of within(dialog).queryAllByRole('textbox')) expect(input).toBeDisabled()
      expect(
        within(dialog).queryByRole('button', { name: /common.operation.save/ }),
      ).not.toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.zoomIn' }))
      expect(
        within(dialog).queryByRole('button', { name: /common.operation.save/ }),
      ).not.toBeInTheDocument()
      await user.keyboard('{Control>}s{/Control}{Meta>}s{/Meta}')
      expect(api.update).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('should allow editing chunk content with edit permission', async () => {
    const user = userEvent.setup()
    await renderChunks(true)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByDisplayValue('Chunk content')
    expect(input).toBeEnabled()
    await user.type(input, ' updated')
    await user.click(within(dialog).getByRole('button', { name: /common.operation.save/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Chunk content updated')).toBeInTheDocument()
    expect(screen.queryByText('Chunk content')).not.toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1', document_id: 'document-1', segment_id: 'segment-1' },
      body: { content: 'Chunk content updated', attachment_ids: [], summary: '' },
    })
  })

  it.each(['paragraph', 'full-doc'] as const)(
    'should disable child mutations and keep %s child content readable',
    async (mode) => {
      const user = userEvent.setup()
      parentMode = mode
      await renderChunks(false, ChunkingMode.parentChild)

      const addButton = screen.getByRole('button', { name: 'common.operation.add' })
      expect(addButton).toBeDisabled()
      await user.click(addButton)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      if (mode === 'paragraph')
        await user.click(screen.getByText(/datasetDocuments.segment.childChunks/))

      const content = screen.getByText('Child chunk content')
      await user.hover(content)
      const deleteButton = await screen.findByRole('button', { name: 'common.operation.remove' })
      expect(deleteButton).toBeDisabled()
      await user.click(deleteButton)
      expect(api.removeChild).not.toHaveBeenCalled()

      await user.click(content)
      const dialog = (await screen.findAllByRole('dialog')).find((element) =>
        within(element).queryByText('datasetDocuments.segment.chunkDetail'),
      )!
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText('Child chunk content')).toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        within(dialog).queryByRole('button', { name: /common.operation.save/ }),
      ).not.toBeInTheDocument()
      await user.keyboard('{Control>}s{/Control}{Meta>}s{/Meta}')
      expect(api.updateChild).not.toHaveBeenCalled()
    },
  )
})
