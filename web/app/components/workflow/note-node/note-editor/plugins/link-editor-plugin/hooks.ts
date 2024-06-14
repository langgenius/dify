import {
  useCallback,
  useEffect,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical'
import {
  mergeRegister,
} from '@lexical/utils'
import {
  TOGGLE_LINK_COMMAND,
} from '@lexical/link'
import { escape } from 'lodash-es'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useNoteEditorStore } from '../../store'
import { urlRegExp } from '../../utils'
import { useToastContext } from '@/app/components/base/toast'

export const useOpenLink = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        setTimeout(() => {
          const {
            selectedLinkUrl,
            selectedIsLink,
            setLinkAnchorElement,
            setLinkOperatorShow,
          } = noteEditorStore.getState()

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
      }),
      editor.registerCommand(
        CLICK_COMMAND,
        (payload) => {
          setTimeout(() => {
            const {
              selectedLinkUrl,
              selectedIsLink,
              setLinkAnchorElement,
              setLinkOperatorShow,
            } = noteEditorStore.getState()

            if (selectedIsLink) {
              if ((payload.metaKey || payload.ctrlKey) && selectedLinkUrl) {
                window.open(selectedLinkUrl, '_blank')
                return true
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
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, noteEditorStore])
}

export const useLink = () => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()
  const { notify } = useToastContext()

  const handleSaveLink = useCallback((url: string) => {
    if (url && !urlRegExp.test(url)) {
      notify({ type: 'error', message: t('workflow.nodes.note.editor.invalidUrl') })
      return
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, escape(url))

    const { setLinkAnchorElement } = noteEditorStore.getState()
    setLinkAnchorElement()
  }, [editor, noteEditorStore, notify, t])

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
