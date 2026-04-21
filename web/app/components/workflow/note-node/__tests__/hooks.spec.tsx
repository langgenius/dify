import { act, renderHook } from '@testing-library/react'
import { useNote } from '../hooks'

const mockHandleNodeDataUpdateWithSyncDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())

vi.mock('../../hooks', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NoteChange: 'note-change',
  },
}))

describe('useNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates theme and author visibility while saving note history entries', () => {
    const { result } = renderHook(() => useNote('note-1'))

    act(() => {
      result.current.handleThemeChange('blue' as never)
      result.current.handleShowAuthorChange(true)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(1, {
      id: 'note-1',
      data: { theme: 'blue' },
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(2, {
      id: 'note-1',
      data: { showAuthor: true },
    })
    expect(mockSaveStateToHistory).toHaveBeenNthCalledWith(1, 'note-change', { nodeId: 'note-1' })
    expect(mockSaveStateToHistory).toHaveBeenNthCalledWith(2, 'note-change', { nodeId: 'note-1' })
  })

  it('serializes non-empty editor state and clears empty editor state', () => {
    const { result } = renderHook(() => useNote('note-2'))
    const nonEmptyEditorState = {
      isEmpty: () => false,
    } as never
    const emptyEditorState = {
      isEmpty: () => true,
    } as never

    act(() => {
      result.current.handleEditorChange(nonEmptyEditorState)
      result.current.handleEditorChange(emptyEditorState)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(1, {
      id: 'note-2',
      data: { text: '{}' },
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(2, {
      id: 'note-2',
      data: { text: '' },
    })
  })
})
