import type { EditorState } from 'lexical'
import type { NoteTheme } from './types'
import { useCallback } from 'react'
import { useNodeDataUpdate, useWorkflowHistory, WorkflowHistoryEvent } from '../hooks'
import { useSetWorkflowNoteShowAuthor } from '../persistence/local-storage-options'

export const useNote = (id: string) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { saveStateToHistory } = useWorkflowHistory()
  const setShowAuthorStorage = useSetWorkflowNoteShowAuthor()

  const handleThemeChange = useCallback((theme: NoteTheme) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { theme } })
    saveStateToHistory(WorkflowHistoryEvent.NoteChange, { nodeId: id })
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])

  const handleEditorChange = useCallback((editorState: EditorState) => {
    if (!editorState?.isEmpty())
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: JSON.stringify(editorState) } })
    else
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: '' } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const handleShowAuthorChange = useCallback((showAuthor: boolean) => {
    setShowAuthorStorage(String(showAuthor))
    handleNodeDataUpdateWithSyncDraft({ id, data: { showAuthor } })
    saveStateToHistory(WorkflowHistoryEvent.NoteChange, { nodeId: id })
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory, setShowAuthorStorage])

  return {
    handleThemeChange,
    handleEditorChange,
    handleShowAuthorChange,
  }
}
