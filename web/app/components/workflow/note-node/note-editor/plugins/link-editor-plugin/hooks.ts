import { toast } from '@langgenius/dify-ui/toast'
import { TOGGLE_LINK_COMMAND } from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { escape } from 'es-toolkit/string'
import { CLICK_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNoteEditorStore } from '../../store'
import { urlRegExp } from '../../utils'

const getClickedLinkElement = (target: EventTarget | null) => {
  return target instanceof HTMLElement
    ? target.closest('.note-editor-theme_link') as HTMLElement | null
    : null
}

export const useOpenLink = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()
  useEffect(() => {
    return mergeRegister(editor.registerUpdateListener(() => {
      setTimeout(() => {
        const { selectedLinkUrl, selectedIsLink, setLinkAnchorElement, setLinkOperatorShow } = noteEditorStore.getState()
        if (selectedIsLink) {
          setLinkAnchorElement(true)
          if (selectedLinkUrl)
            setLinkOperatorShow(true)
          else
            setLinkOperatorShow(false)
        }
        else {
          setLinkAnchorElement()
          setLinkOperatorShow(false)
        }
      })
    }), editor.registerCommand(CLICK_COMMAND, (payload) => {
      setTimeout(() => {
        const {
          selectedLinkUrl,
          selectedIsLink,
          setLinkAnchorElement,
          setLinkOperatorShow,
          setSelectedLinkUrl,
          setSelectedIsLink,
        } = noteEditorStore.getState()
        const clickedLinkElement = getClickedLinkElement(payload.target)
        const clickedLinkUrl = clickedLinkElement?.getAttribute('href') || selectedLinkUrl

        if (clickedLinkElement && clickedLinkUrl) {
          if (payload.metaKey || payload.ctrlKey) {
            window.open(clickedLinkUrl, '_blank')
            return
          }

          setSelectedLinkUrl(clickedLinkUrl)
          setSelectedIsLink(true)
          setLinkAnchorElement(clickedLinkElement)
          setLinkOperatorShow(true)
          return
        }

        if (selectedIsLink) {
          if ((payload.metaKey || payload.ctrlKey) && selectedLinkUrl) {
            window.open(selectedLinkUrl, '_blank')
            return
          }
          setLinkAnchorElement(true)
          if (selectedLinkUrl)
            setLinkOperatorShow(true)
          else
            setLinkOperatorShow(false)
        }
        else {
          setLinkAnchorElement()
          setLinkOperatorShow(false)
        }
      })
      return !!getClickedLinkElement(payload.target)
    }, COMMAND_PRIORITY_LOW))
  }, [editor, noteEditorStore])
}
export const useLink = () => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()
  const handleSaveLink = useCallback((url: string) => {
    if (url && !urlRegExp.test(url)) {
      toast.error(t('nodes.note.editor.invalidUrl', { ns: 'workflow' }))
      return
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, escape(url))
    const { setLinkAnchorElement } = noteEditorStore.getState()
    setLinkAnchorElement()
  }, [editor, noteEditorStore, t])
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
