import {
  $isLinkNode,
  TOGGLE_LINK_COMMAND,
} from '@lexical/link'
import { INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from '@lexical/selection'
import { mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useNoteEditorStore } from '../store'
import { getSelectedNode } from '../utils'

const DEFAULT_FONT_SIZE = '12px'

const updateFontSizeFromSelection = (setFontSize: (fontSize: string) => void) => {
  const selection = $getSelection()
  if ($isRangeSelection(selection))
    setFontSize($getSelectionStyleValueForProperty(selection, 'font-size', DEFAULT_FONT_SIZE))
}

const toggleLink = (
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  noteEditorStore: ReturnType<typeof useNoteEditorStore>,
) => {
  editor.update(() => {
    const selection = $getSelection()

    if (!$isRangeSelection(selection))
      return

    const node = getSelectedNode(selection)
    const parent = node.getParent()
    const { setLinkAnchorElement } = noteEditorStore.getState()

    if ($isLinkNode(parent) || $isLinkNode(node)) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      setLinkAnchorElement()
      return
    }

    editor.dispatchCommand(TOGGLE_LINK_COMMAND, '')
    setLinkAnchorElement(true)
  })
}

const toggleBullet = (
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  selectedIsBullet: boolean,
) => {
  if (!selectedIsBullet) {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    return
  }

  editor.update(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection))
      $setBlocksType(selection, () => $createParagraphNode())
  })
}

export const useCommand = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  const handleCommand = useCallback((type: string) => {
    if (type === 'bold' || type === 'italic' || type === 'strikethrough') {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, type)
      return
    }

    if (type === 'link') {
      toggleLink(editor, noteEditorStore)
      return
    }

    if (type === 'bullet')
      toggleBullet(editor, noteEditorStore.getState().selectedIsBullet)
  }, [editor, noteEditorStore])

  return {
    handleCommand,
  }
}

export const useFontSize = () => {
  const [editor] = useLexicalComposerContext()
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [fontSizeSelectorShow, setFontSizeSelectorShow] = useState(false)

  const handleFontSize = useCallback((fontSize: string) => {
    editor.update(() => {
      const selection = $getSelection()

      if ($isRangeSelection(selection))
        $patchStyleText(selection, { 'font-size': fontSize })
    })
  }, [editor])

  const handleOpenFontSizeSelector = useCallback((newFontSizeSelectorShow: boolean) => {
    if (newFontSizeSelectorShow) {
      editor.update(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection))
          $setSelection(selection.clone())
      })
    }
    setFontSizeSelectorShow(newFontSizeSelectorShow)
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        editor.getEditorState().read(() => {
          updateFontSizeFromSelection(setFontSize)
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateFontSizeFromSelection(setFontSize)
          return false
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    )
  }, [editor])

  return {
    fontSize,
    handleFontSize,
    fontSizeSelectorShow,
    handleOpenFontSizeSelector,
  }
}
