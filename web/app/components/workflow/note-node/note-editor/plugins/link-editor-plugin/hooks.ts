import {
  useCallback,
  useEffect,
} from 'react'
import {
  $getSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical'
import {
  mergeRegister,
} from '@lexical/utils'
import {
  $isLinkNode,
  TOGGLE_LINK_COMMAND,
} from '@lexical/link'
import type { LinkNode } from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useNoteEditorStore } from '../../store'
import { getSelectedNode } from '../../utils'

export const useOpenLink = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (payload) => {
          const selection = $getSelection()

          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const node = getSelectedNode(selection)
            const parent = node.getParent()

            if ($isLinkNode(parent) || $isLinkNode(node)) {
              const linkUrl = ((parent || node) as LinkNode).getURL()
              if (payload.metaKey || payload.ctrlKey) {
                window.open(linkUrl, '_blank')
                return true
              }
              else {
                const {
                  setLinkAnchorElement,
                  setLinkOperatorShow,
                  setSelectedLinkUrl,
                } = noteEditorStore.getState()
                setLinkAnchorElement(true)
                setSelectedLinkUrl(linkUrl)
                setLinkOperatorShow(true)
              }
            }
            else {
              const {
                setLinkAnchorElement,
                setLinkOperatorShow,
              } = noteEditorStore.getState()
              setLinkAnchorElement()
              setLinkOperatorShow(false)
            }
          }
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, noteEditorStore])
}

export const useLink = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleSaveLink = useCallback((url: string) => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)

    const { setLinkAnchorElement } = noteEditorStore.getState()
    setLinkAnchorElement()
  }, [editor, noteEditorStore])

  const handleUnlink = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)

    const { setLinkAnchorElement } = noteEditorStore.getState()
    setLinkAnchorElement()
  }, [editor, noteEditorStore])

  return {
    handleSaveLink,
    handleUnlink,
  }
}
