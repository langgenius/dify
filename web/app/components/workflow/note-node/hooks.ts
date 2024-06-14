import { useCallback } from 'react'
import type { EditorState } from 'lexical'
import { useNodeDataUpdate } from '../hooks'
import type { NoteTheme } from './types'

export const useNote = (id: string) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const handleThemeChange = useCallback((theme: NoteTheme) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { theme } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const handleEditorChange = useCallback((editorState: EditorState) => {
    if (!editorState?.isEmpty())
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: JSON.stringify(editorState) } })
    else
      handleNodeDataUpdateWithSyncDraft({ id, data: { text: '' } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const handleShowAuthorChange = useCallback((showAuthor: boolean) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { showAuthor } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  return {
    handleThemeChange,
    handleEditorChange,
    handleShowAuthorChange,
  }
}
