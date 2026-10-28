import type { SegmentResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SegmentList from '../segment-list'

vi.mock('../../context', () => ({
  useDocumentContext: (
    select: (state: { docForm: ChunkingMode; parentMode: string; canEdit: boolean }) => unknown,
  ) => select({ docForm: ChunkingMode.text, parentMode: 'paragraph', canEdit: true }),
}))
vi.mock('../index', () => ({
  useSegmentListContext: (
    select: (state: { currSegment: null; currChildChunk: null }) => unknown,
  ) => select({ currSegment: null, currChildChunk: null }),
}))
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
  child_chunks: [],
}

const props = {
  ref: null,
  isLoading: false,
  items: [segment],
  onClick: vi.fn(),
  onChangeSwitch: vi.fn(),
  onDelete: vi.fn(),
  onDeleteChildChunk: vi.fn(),
  handleAddNewChildChunk: vi.fn(),
  onClickSlice: vi.fn(),
  embeddingAvailable: true,
  onClearFilter: vi.fn(),
}
beforeEach(() => vi.clearAllMocks())

it('selects the requested chunk independently and opens its exact detail in edit mode', async () => {
  const user = userEvent.setup()
  const second = { ...segment, id: 'segment-2', position: 2, content: 'Other content' }
  const onSelection = vi.fn()
  function Harness() {
    const [value, setValue] = useState<string[]>([])
    return (
      <CheckboxGroup
        value={value}
        allValues={[segment.id, second.id]}
        onValueChange={(next) => {
          setValue(next)
          onSelection(next)
        }}
      >
        <SegmentList {...props} items={[segment, second]} />
      </CheckboxGroup>
    )
  }
  render(<Harness />)
  await user.click(screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 2' }))
  expect(onSelection).toHaveBeenLastCalledWith(['segment-2'])
  expect(
    screen.getByRole('checkbox', { name: 'datasetDocuments.segment.chunk 1' }),
  ).not.toBeChecked()
  expect(props.onClick).not.toHaveBeenCalled()
  await user.click(await screen.findByText('Other content'))
  expect(props.onClick).toHaveBeenCalledWith(second, true)
})

it('clears a search with no matching chunks', async () => {
  const user = userEvent.setup()
  render(<SegmentList {...props} items={[]} />)
  await user.click(screen.getByRole('button', { name: 'datasetDocuments.segment.clearFilter' }))
  expect(props.onClearFilter).toHaveBeenCalledOnce()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

it('withholds stale chunk actions while loading', () => {
  render(<SegmentList {...props} isLoading />)
  expect(screen.queryByText('Chunk content')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
