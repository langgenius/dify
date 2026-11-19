import type { NoteNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { useNodes } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../__tests__/workflow-test-env'
import { CUSTOM_NOTE_NODE } from '../constants'
import { useNote } from '../hooks'
import { NoteTheme } from '../types'

const renderNote = () =>
  renderWorkflowCanvasHook(() => ({ note: useNote('note-1'), nodes: useNodes<NoteNodeType>() }), {
    nodes: [
      createNode({
        id: 'note-1',
        type: CUSTOM_NOTE_NODE,
        data: { text: '', theme: NoteTheme.blue, author: 'Alice', showAuthor: true },
      }),
    ],
    historyStore: { nodes: [], edges: [] },
  })

const noteData = (result: ReturnType<typeof renderNote>['result']) =>
  result.current.nodes.find((node) => node.id === 'note-1')!.data

describe('useNote', () => {
  it('changes the note theme and records it in workflow history', async () => {
    const { result, store } = renderNote()

    act(() => {
      result.current.note.handleThemeChange(NoteTheme.violet)
    })

    expect(noteData(result)).toMatchObject({ theme: NoteTheme.violet })
    await waitFor(() =>
      expect(store.getState().workflowHistory).toMatchObject({
        workflowHistoryEvent: 'NoteChange',
        workflowHistoryEventMeta: { nodeId: 'note-1' },
      }),
    )
  })

  it('serializes non-empty editor state and clears empty editor state', () => {
    const { result } = renderNote()
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

    act(() => {
      result.current.note.handleEditorChange(editor.getEditorState())
    })

    const restored = editor.parseEditorState(noteData(result).text)
    expect(restored.read(() => $getRoot().getTextContent())).toBe('Remember this decision')

    act(() => {
      result.current.note.handleEditorChange(emptyEditorState)
    })

    expect(noteData(result)).toMatchObject({ text: '' })
  })
})
