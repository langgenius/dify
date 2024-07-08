import { useCallback } from 'react'
import type { EditorState } from 'lexical'
import { WorkflowHistoryEvent, useNodeDataUpdate, useWorkflowHistory } from '../hooks'
import type { NoteTheme } from './types'

export const useNote = (id: string) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleThemeChange = useCallback((theme: NoteTheme) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { theme } })
    saveStateToHistory(WorkflowHistoryEvent.NoteChange)
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])

  const handleEditorChange = useCallback((editorState: EditorState) => {
    if (!editorState?.isEmpty())
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: JSON.stringify(editorState) } })
    else
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: '' } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const handleShowAuthorChange = useCallback((showAuthor: boolean) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { showAuthor } })
    saveStateToHistory(WorkflowHistoryEvent.NoteChange)
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])

  return {
    handleThemeChange,
    handleEditorChange,
    handleShowAuthorChange,
  }
}
