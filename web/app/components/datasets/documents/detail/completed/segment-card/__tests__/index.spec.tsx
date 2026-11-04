import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps } from 'react'
import type { DocumentContextValue } from '../../../context'
import type { Attachment } from '@/models/datasets'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DocumentContext } from '../../../context'
import SegmentCard from '../index'

const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  name: 'test-image.png',
  size: 1024,
  extension: 'png',
  mime_type: 'image/png',
  source_url: 'https://example.com/test-image.png',
  ...overrides,
})

const createMockChildChunk = (overrides: Partial<ChildChunkResponse> = {}): ChildChunkResponse => ({
  id: 'child-chunk-1',
  position: 1,
  segment_id: 'segment-1',
  content: 'Child chunk content',
  word_count: 100,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
  ...overrides,
})

const createMockSegmentDetail = (
  overrides: Partial<SegmentResponse & { document?: { name: string } }> = {},
): SegmentResponse & { document?: { name: string } } => ({
  id: 'segment-1',
  position: 1,
  document_id: 'doc-1',
  content: 'Test segment content',
  sign_content: 'Test signed content',
  word_count: 100,
  tokens: 50,
  keywords: ['keyword1', 'keyword2'],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 10,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000100,
  completed_at: 1700000200,
  error: null,
  stopped_at: 0,
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  document: { name: 'Test Document' },
  ...overrides,
})

const defaultFocused = { segmentIndex: false, segmentContent: false }

type CardProps = ComponentProps<typeof SegmentCard>
function renderCard(props: Partial<CardProps> = {}, context: DocumentContextValue = {}) {
  const document = {
    docForm: ChunkingMode.text,
    parentMode: 'paragraph' as const,
    canEdit: true,
    ...context,
  }
  return renderWithConsoleQuery(
    <DocumentContext.Provider value={document}>
      <SegmentCard
        loading={false}
        detail={createMockSegmentDetail()}
        focused={defaultFocused}
        {...props}
      />
    </DocumentContext.Provider>,
  )
}

describe('SegmentCard', () => {
  it.each([true, false])(
    'prevents chunk mutations without edit permission (enabled: %s)',
    async (enabled) => {
      const user = userEvent.setup()
      const onClickEdit = vi.fn()
      const onDelete = vi.fn()
      const onChangeSwitch = vi.fn()
      renderCard(
        {
          detail: createMockSegmentDetail({ enabled }),
          embeddingAvailable: true,
          onClickEdit,
          onDelete,
          onChangeSwitch,
        },
        { canEdit: false },
      )
      for (const name of ['common.operation.edit', 'common.operation.delete']) {
        const button = screen.getByRole('button', { name })
        expect(button).toBeDisabled()
        await user.click(button)
      }
      const toggle = screen.getByRole('switch')
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      await user.click(toggle)
      expect(onClickEdit).not.toHaveBeenCalled()
      expect(onDelete).not.toHaveBeenCalled()
      expect(onChangeSwitch).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(
        screen.getByText(`datasetDocuments.list.status.${enabled ? 'enabled' : 'disabled'}`),
      ).toBeInTheDocument()
    },
  )

  it('renders chunk identity, counts, edited marker and keywords', () => {
    renderCard({
      detail: createMockSegmentDetail({
        position: 5,
        word_count: 250,
        hit_count: 42,
        updated_at: 1700000001,
      }),
    })
    expect(
      screen.getByRole('button', {
        name: 'datasetDocuments.segment.chunk-05 datasetDocuments.segment.chunkDetail',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('250 datasetDocuments.segment.characters:{"count":250}'),
    ).toBeInTheDocument()
    expect(screen.getByText('42 datasetDocuments.segment.hitCount')).toBeInTheDocument()
    expect(screen.getByText('datasetDocuments.segment.edited')).toBeInTheDocument()
    expect(screen.getByText('keyword1')).toBeInTheDocument()
    expect(screen.getByText('keyword2')).toBeInTheDocument()
  })

  it.each([
    { archived: true, status: 'completed' as const },
    { archived: false, status: 'indexing' as const },
  ])('disables changes for $status / archived=$archived', ({ archived, status }) => {
    renderCard({ archived, embeddingAvailable: true, detail: createMockSegmentDetail({ status }) })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })

  it('hides mutation controls when embeddings are unavailable', () => {
    renderCard({ embeddingAvailable: false })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })

  it('cancels deletion without submitting, then confirms the exact chunk', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderCard({
      onDelete,
      embeddingAvailable: true,
      detail: createMockSegmentDetail({ id: 'delete-me' }),
    })
    const remove = screen.getByRole('button', { name: 'common.operation.delete' })
    await user.click(remove)
    let dialog = await screen.findByRole('alertdialog', { name: 'datasetDocuments.segment.delete' })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(remove)
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.sure' }))
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('delete-me')
  })

  it('opens details with the keyboard and keeps edit and switch actions separate', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onClickEdit = vi.fn()
    const onChangeSwitch = vi.fn()
    function Caller() {
      const [detail, setDetail] = useState(createMockSegmentDetail())
      return (
        <DocumentContext.Provider value={{ docForm: ChunkingMode.text, canEdit: true }}>
          <SegmentCard
            loading={false}
            detail={detail}
            focused={defaultFocused}
            embeddingAvailable
            onClick={onClick}
            onClickEdit={onClickEdit}
            onChangeSwitch={async (enabled, id) => {
              onChangeSwitch(enabled, id)
              setDetail({ ...detail, enabled })
            }}
          />
        </DocumentContext.Provider>
      )
    }
    renderWithConsoleQuery(<Caller />)
    screen.getByRole('button', { name: /segment.chunkDetail/ }).focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(onClickEdit).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('switch'))
    expect(onChangeSwitch).toHaveBeenCalledExactlyOnceWith(false, 'segment-1')
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.getByText('datasetDocuments.list.status.disabled')).toBeInTheDocument()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows a full-document preview and opens only through View more', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderCard(
      {
        onClick,
        detail: createMockSegmentDetail({
          updated_at: 1700000001,
          child_chunks: [createMockChildChunk()],
          sign_content: '[Document preview](https://example.com/preview)',
        }),
      },
      { docForm: ChunkingMode.parentChild, parentMode: 'full-doc' },
    )
    const preview = await screen.findByRole('link', { name: 'Document preview' })
    expect(preview).toHaveAttribute('href', 'https://example.com/preview')
    await user.click(preview)
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.queryByText('datasetDocuments.segment.edited')).not.toBeInTheDocument()
    expect(screen.queryByText('datasetDocuments.list.status.enabled')).not.toBeInTheDocument()
    expect(screen.queryByText(/segment.childChunks/)).not.toBeInTheDocument()
    expect(screen.queryByText('keyword1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.viewMore' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders parent child count and adds to the selected parent', async () => {
    const user = userEvent.setup()
    const handleAddNewChildChunk = vi.fn()
    renderCard(
      {
        handleAddNewChildChunk,
        detail: createMockSegmentDetail({
          id: 'parent-id',
          child_chunks: [
            createMockChildChunk(),
            createMockChildChunk({ id: 'child-2', position: 2 }),
          ],
        }),
      },
      { docForm: ChunkingMode.parentChild },
    )
    expect(screen.getByText(/2 datasetDocuments.segment.childChunks/)).toBeInTheDocument()
    expect(screen.queryByText('keyword1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(handleAddNewChildChunk).toHaveBeenCalledExactlyOnceWith('parent-id')
  })

  it('omits the child list for a parent with no children', () => {
    renderCard({}, { docForm: ChunkingMode.parentChild })
    expect(screen.queryByText(/segment.childChunks/)).not.toBeInTheDocument()
  })

  it('renders attachment thumbnails from the supplied source and omits them when empty', () => {
    const { unmount } = renderCard({
      detail: createMockSegmentDetail({ attachments: [createMockAttachment()] }),
    })
    const attachment = screen.getByRole('button', { name: 'test-image.png' })
    expect(within(attachment).getByRole('img', { name: 'test-image.png' })).toHaveAttribute(
      'src',
      'https://example.com/test-image.png',
    )
    unmount()
    renderCard()
    expect(screen.queryByRole('button', { name: 'test-image.png' })).not.toBeInTheDocument()
  })

  it('renders question and answer Markdown instead of signed content in QA mode', async () => {
    renderCard(
      {
        detail: createMockSegmentDetail({
          content: '[Question](https://example.com/question)',
          answer: '[Answer](https://example.com/answer)',
          sign_content: 'Ignored signed content',
        }),
      },
      { docForm: ChunkingMode.qa },
    )
    expect(await screen.findByRole('link', { name: 'Question' })).toHaveAttribute(
      'href',
      'https://example.com/question',
    )
    expect(screen.getByRole('link', { name: 'Answer' })).toHaveAttribute(
      'href',
      'https://example.com/answer',
    )
    expect(screen.getByText('Q')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('Ignored signed content')).not.toBeInTheDocument()
    expect(screen.queryByText('keyword1')).not.toBeInTheDocument()
  })

  it.each(['[Signed content](https://example.com/signed)', ''])(
    'uses signed content when present, otherwise original content (%s)',
    async (sign_content) => {
      renderCard({
        detail: createMockSegmentDetail({
          content: '[Original content](https://example.com/original)',
          sign_content,
          answer: '',
        }),
      })
      expect(
        await screen.findByRole('link', {
          name: sign_content ? 'Signed content' : 'Original content',
        }),
      ).toHaveAttribute(
        'href',
        sign_content ? 'https://example.com/signed' : 'https://example.com/original',
      )
      expect(screen.queryByText('Q')).not.toBeInTheDocument()
      expect(screen.queryByText('A')).not.toBeInTheDocument()
    },
  )

  it('withholds stale content while loading', () => {
    renderCard({ loading: true })
    expect(screen.queryByText('Test signed content')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /segment.chunkDetail/ })).not.toBeInTheDocument()
  })
})
