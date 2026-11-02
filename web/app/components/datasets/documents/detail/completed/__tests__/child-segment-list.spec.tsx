import type { ChildChunkResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ChildSegmentList from '../child-segment-list'

let parentMode = 'paragraph'
vi.mock('../../context', () => ({
  useDocumentContext: (select: (state: { parentMode: string; canEdit: boolean }) => unknown) =>
    select({ parentMode, canEdit: true }),
}))
vi.mock('../index', () => ({
  useSegmentListContext: (select: (state: { currChildChunk: null }) => unknown) =>
    select({ currChildChunk: null }),
}))
const child: ChildChunkResponse = {
  id: 'child-1',
  segment_id: 'parent-1',
  content: 'Child content',
  position: 1,
  word_count: 13,
  created_at: 1700000000,
  updated_at: 1700000001,
  type: 'automatic',
}
const defaultProps = {
  childChunks: [child],
  parentChunkId: 'parent-1',
  enabled: true,
  total: 1,
  inputValue: '',
  onDelete: vi.fn().mockResolvedValue(undefined),
  onClickSlice: vi.fn(),
  handleAddNewChildChunk: vi.fn(),
}
beforeEach(() => {
  parentMode = 'paragraph'
})

it('expands child content and dispatches child operations with their identities', async () => {
  const user = userEvent.setup()
  render(<ChildSegmentList {...defaultProps} />)
  expect(screen.queryByText('Child content')).not.toBeInTheDocument()
  await user.click(screen.getByText(/datasetDocuments.segment.childChunks/))
  expect(screen.getByText(/datasetDocuments.segment.edited/)).toBeInTheDocument()
  await user.click(screen.getByText('Child content'))
  expect(defaultProps.onClickSlice).toHaveBeenCalledWith(child)
  await user.hover(screen.getByText('Child content'))
  await user.click(await screen.findByRole('button', { name: 'common.operation.remove' }))
  expect(defaultProps.onDelete).toHaveBeenCalledWith('parent-1', 'child-1')
  expect(defaultProps.onClickSlice).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(defaultProps.handleAddNewChildChunk).toHaveBeenCalledWith('parent-1')
  await user.click(screen.getByText(/datasetDocuments.segment.childChunks/))
  expect(screen.queryByText('Child content')).not.toBeInTheDocument()
})

it('searches full-document child chunks and clears an empty result filter', async () => {
  const user = userEvent.setup()
  parentMode = 'full-doc'
  function Harness() {
    const [inputValue, handleInputChange] = useState('')
    return (
      <ChildSegmentList
        {...defaultProps}
        childChunks={inputValue ? [] : [child]}
        total={inputValue ? 0 : 1}
        inputValue={inputValue}
        handleInputChange={handleInputChange}
        onClearFilter={() => handleInputChange('')}
      />
    )
  }
  render(<Harness />)
  expect(screen.getByText('Child content')).toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'missing')
  expect(screen.getByText(/datasetDocuments.segment.searchResults/)).toBeInTheDocument()
  expect(screen.getByText('datasetDocuments.segment.empty')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'datasetDocuments.segment.clearFilter' }))
  expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveValue('')
  expect(screen.getByText('Child content')).toBeInTheDocument()
})

it('blocks adding child chunks while the full document is loading', async () => {
  const user = userEvent.setup()
  parentMode = 'full-doc'
  render(<ChildSegmentList {...defaultProps} isLoading />)
  const add = screen.getByRole('button', { name: 'common.operation.add' })
  expect(add).toBeDisabled()
  await user.click(add)
  expect(defaultProps.handleAddNewChildChunk).not.toHaveBeenCalled()
  expect(screen.queryByText('Child content')).not.toBeInTheDocument()
})
