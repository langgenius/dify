import type { ChildChunkDetail, ParentMode, SegmentDetailModel } from '@/models/datasets'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DocumentContext } from '../../context'
import Completed from '../index'

const childChunk: ChildChunkDetail = {
  id: 'child-1',
  segment_id: 'segment-1',
  position: 1,
  content: 'Child chunk content',
  word_count: 19,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
}

const segment: SegmentDetailModel = {
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
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [childChunk],
}

let parentMode: ParentMode = 'paragraph'
const onChangeSwitch = vi.fn()
const onDelete = vi.fn()
const onUpdate = vi.fn()
const onDeleteChildChunk = vi.fn()
const onUpdateChildChunk = vi.fn()

// Keep selection, cards, action bars and drawers real; isolate their data and mutation hooks.
vi.mock('../hooks/use-segment-list-data', () => ({
  useSegmentListData: () => ({
    segments: [segment],
    segmentListData: { total: 1 },
    totalText: '1 chunk',
    isLoadingSegmentList: false,
    isFullDocMode: parentMode === 'full-doc',
    onChangeSwitch,
    onDelete,
    handleUpdateSegment: onUpdate,
  }),
}))

vi.mock('../hooks/use-child-segment-data', () => ({
  useChildSegmentData: () => ({
    childSegments: [childChunk],
    childChunkListData: { total: 1 },
    isLoadingChildSegmentList: false,
    onDeleteChildChunk,
    handleUpdateChildChunk: onUpdateChildChunk,
  }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { indexing_technique: string; runtime_mode: string } }) => unknown,
  ) => selector({ dataset: { indexing_technique: 'high_quality', runtime_mode: 'general' } }),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: () => null,
}))

function renderChunks(canEdit: boolean, docForm: ChunkingMode = ChunkingMode.text) {
  return render(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector contexts are not React 19 context components.
    <DocumentContext.Provider
      value={{ datasetId: 'dataset-1', documentId: 'document-1', docForm, parentMode, canEdit }}
    >
      <Completed
        embeddingAvailable
        showNewSegmentModal={false}
        onNewSegmentModalChange={vi.fn()}
        importStatus={undefined}
      />
    </DocumentContext.Provider>,
  )
}

describe('Chunk permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parentMode = 'paragraph'
  })

  it('should pass read-only permission to the batch actions and allow cancelling selection', async () => {
    const user = userEvent.setup()
    renderChunks(false)

    const checkbox = screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' })
    await user.click(checkbox)

    for (const action of ['enable', 'disable', 'delete']) {
      const button = screen.getByRole('button', { name: `dataset.batchAction.${action}` })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(onChangeSwitch).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
    expect(checkbox).not.toBeChecked()
    expect(
      screen.queryByRole('button', { name: 'dataset.batchAction.enable' }),
    ).not.toBeInTheDocument()
  })

  it('should allow batch mutations with edit permission', async () => {
    const user = userEvent.setup()
    renderChunks(true)
    await user.click(screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' }))

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.enable' }))
    expect(onChangeSwitch).toHaveBeenCalledWith(true, '')
    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.disable' }))
    expect(onChangeSwitch).toHaveBeenCalledWith(false, '')

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.sure' }))
    expect(onDelete).toHaveBeenCalledWith('')
  })

  it.each([ChunkingMode.text, ChunkingMode.qa, ChunkingMode.parentChild])(
    'should open %s chunk content in read-only mode without edit permission',
    async (docForm) => {
      const user = userEvent.setup()
      renderChunks(false, docForm)
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
      expect(onUpdate).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('should allow editing chunk content with edit permission', async () => {
    const user = userEvent.setup()
    renderChunks(true)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByDisplayValue('Chunk content')
    expect(input).toBeEnabled()
    await user.type(input, ' updated')
    await user.click(within(dialog).getByRole('button', { name: /common.operation.save/ }))
    expect(onUpdate).toHaveBeenCalledWith(
      'segment-1',
      'Chunk content updated',
      '',
      [],
      [],
      '',
      false,
    )
  })

  it.each(['paragraph', 'full-doc'] as const)(
    'should disable child mutations and keep %s child content readable',
    async (mode) => {
      const user = userEvent.setup()
      parentMode = mode
      renderChunks(false, ChunkingMode.parentChild)

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
      expect(onDeleteChildChunk).not.toHaveBeenCalled()

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
      expect(onUpdateChildChunk).not.toHaveBeenCalled()
    },
  )
})
