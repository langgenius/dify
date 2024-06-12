import { useCallback } from 'react'
import type { EditorState } from 'lexical'

export const useNote = () => {
  const handleColorChange = useCallback(() => {

  }, [])

  const handleEditorChange = useCallback((editorState: EditorState) => {

  }, [])

  return {
    handleColorChange,
    handleEditorChange,
  }
}
