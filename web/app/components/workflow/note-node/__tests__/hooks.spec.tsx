import { act, renderHook } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { NOTE_SHOW_AUTHOR_STORAGE_KEY } from '../constants'
import { useNote } from '../hooks'

const mockHandleNodeDataUpdateWithSyncDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
}))

vi.mock('../../hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NoteChange: 'note-change',
  },
}))

describe('useNote', () => {
  beforeEach(() => {
    localStorage.removeItem(NOTE_SHOW_AUTHOR_STORAGE_KEY)
  })

  it('updates theme and author visibility while saving note history entries', () => {
    const { result } = renderHook(() => useNote('note-1'))

    act(() => {
      result.current.handleThemeChange('blue')
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
    expect(localStorage.getItem(NOTE_SHOW_AUTHOR_STORAGE_KEY)).toBe('true')
  })

  it('serializes non-empty editor state and clears empty editor state', () => {
    const { result } = renderHook(() => useNote('note-2'))
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    const emptyEditorState = editor.getEditorState()
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('Remember this decision')))
      },
      { discrete: true },
    )
    const nonEmptyEditorState = editor.getEditorState()

    act(() => {
      result.current.handleEditorChange(nonEmptyEditorState)
      result.current.handleEditorChange(emptyEditorState)
    })

    const saved = mockHandleNodeDataUpdateWithSyncDraft.mock.calls[0]![0]
    expect(saved.id).toBe('note-2')
    const restored = editor.parseEditorState(saved.data.text)
    expect(restored.read(() => $getRoot().getTextContent())).toBe('Remember this decision')
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(2, {
      id: 'note-2',
      data: { text: '' },
    })
  })
})
