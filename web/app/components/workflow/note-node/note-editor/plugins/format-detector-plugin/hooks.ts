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
import type { LinkNode } from '@lexical/link'
import { $isLinkNode } from '@lexical/link'
import { getSelectedNode } from '../../utils'
import { useNoteEditorStore } from '../../store'

export const useFormatDetector = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleFormat = useCallback(() => {
    editor.getEditorState().read(() => {
      if (editor.isComposing())
        return

      const selection = $getSelection()
      if (!($isRangeSelection(selection) && !selection?.isCollapsed()))
        return

      const node = getSelectedNode(selection)
      const {
        setSelectedIsBold,
        setSelectedIsStrikeThrough,
        setSelectedLinkUrl,
      } = noteEditorStore.getState()
      setSelectedIsBold(selection.hasFormat('bold'))
      setSelectedIsStrikeThrough(selection.hasFormat('strikethrough'))
      const parent = node.getParent()
      if ($isLinkNode(parent) || $isLinkNode(node))
        setSelectedLinkUrl($isLinkNode(parent) ? parent.getURL() : (node as LinkNode).getURL())
      else
        setSelectedLinkUrl('')
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
