import type { LinkNode } from '@lexical/link'
import { $isLinkNode } from '@lexical/link'
import { $isListItemNode } from '@lexical/list'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import {
  useCallback,
  useEffect,
} from 'react'
import { useNoteEditorStore } from '../../store'
import { getSelectedNode } from '../../utils'

export const useFormatDetector = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleFormat = useCallback(() => {
    editor.getEditorState().read(() => {
      if (editor.isComposing())
        return

      const selection = $getSelection()

      if ($isRangeSelection(selection)) {
        const node = getSelectedNode(selection)
        const {
          setSelectedIsBold,
          setSelectedIsItalic,
          setSelectedIsStrikeThrough,
          setSelectedLinkUrl,
          setSelectedIsLink,
          setSelectedIsBullet,
        } = noteEditorStore.getState()
        setSelectedIsBold(selection.hasFormat('bold'))
        setSelectedIsItalic(selection.hasFormat('italic'))
        setSelectedIsStrikeThrough(selection.hasFormat('strikethrough'))
        const parent = node.getParent()
        if ($isLinkNode(parent) || $isLinkNode(node)) {
          const linkUrl = ($isLinkNode(parent) ? parent : node as LinkNode).getURL()
          setSelectedLinkUrl(linkUrl)
          setSelectedIsLink(true)
        }
        else {
          setSelectedLinkUrl('')
          setSelectedIsLink(false)
        }

        if ($isListItemNode(parent) || $isListItemNode(node))
          setSelectedIsBullet(true)
        else
          setSelectedIsBullet(false)
      }
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
