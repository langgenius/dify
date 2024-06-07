import {
  useCallback,
} from 'react'
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import {
  $isLinkNode,
  TOGGLE_LINK_COMMAND,
} from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useNoteEditorStore } from '../store'
import { getSelectedNode } from '../utils'

export const useCommand = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleCommand = useCallback((type: string) => {
    if (type === 'bold')
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')

    if (type === 'strikethrough')
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
    if (type === 'link') {
      editor.update(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          const node = getSelectedNode(selection)
          const parent = node.getParent()

          if ($isLinkNode(parent) || $isLinkNode(node))
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
          else
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://')

          // setTimeout(() => {
          //   const nativeSelection = window.getSelection()
          //   editor.getEditorState().read(() => {
          //     const node = getSelectedNode(selection)
          //     console.log(node, 'node')
          //   })

          //   if (nativeSelection?.focusNode) {
          //     const { setAnchorElement } = noteEditorStore.getState()
          //     const parent = nativeSelection.focusNode.parentElement
          //     setAnchorElement(parent)
          //   }
          // })
        }
      })
    }
  }, [editor, noteEditorStore])

  return {
    handleCommand,
  }
}
