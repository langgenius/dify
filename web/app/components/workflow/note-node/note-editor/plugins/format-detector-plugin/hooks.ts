import {
  useCallback,
  useEffect,
} from 'react'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isLinkNode } from '@lexical/link'
import { getSelectedNode } from '../../utils'
import { useNoteEditorStore } from '../../store'

export const useFormatDetector = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleFormat = useCallback(() => {
    editor.getEditorState().read(() => {
      // Should not to pop up the floating toolbar when using IME input
      if (editor.isComposing())
        return

      const selection = $getSelection()
      if (!$isRangeSelection(selection))
        return

      const node = getSelectedNode(selection)
      const {
        setIsBold,
        setIsStrikeThrough,
        setIsLink,
      } = noteEditorStore.getState()
      setIsBold(selection.hasFormat('bold'))
      setIsStrikeThrough(selection.hasFormat('strikethrough'))
      const parent = node.getParent()
      if ($isLinkNode(parent) || $isLinkNode(node))
        setIsLink(true)
      else
        setIsLink(false)
    })
  }, [editor, noteEditorStore])

  useEffect(() => {
    document.addEventListener('selectionchange', handleFormat)
    return () => {
      document.removeEventListener('selectionchange', handleFormat)
    }
  }, [handleFormat])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        handleFormat()
      }),
    )
  }, [editor, handleFormat])

  return {
    handleFormat,
  }
}
