import { TOGGLE_LINK_COMMAND } from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { CLICK_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useNoteEditorStore } from '../../store'
import { urlRegExp } from '../../utils'

const getClickedLinkElement = (target: EventTarget | null) => {
  return target instanceof HTMLElement
    ? (target.closest('.note-editor-theme_link') as HTMLElement | null)
    : null
}

export const useOpenLink = () => {
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()
  useEffect(() => {
    const pendingUpdates = new Set<ReturnType<typeof setTimeout>>()
    const schedule = (update: () => void) => {
      const timer = setTimeout(() => {
        pendingUpdates.delete(timer)
        update()
      })
      pendingUpdates.add(timer)
    }
    return mergeRegister(
      () => {
        pendingUpdates.forEach(clearTimeout)
        pendingUpdates.clear()
      },
      editor.registerUpdateListener(() => {
        schedule(() => {
          const {
            selectedLinkUrl,
            selectedIsLink,
            selectedLinkKey,
            dismissedLinkKey,
            setLinkAnchorElement,
            setLinkOperatorShow,
          } = noteEditorStore.getState()
          if (selectedIsLink) {
            // Restoring the editor selection must not reopen a dismissed surface.
            if (dismissedLinkKey && dismissedLinkKey === selectedLinkKey) return
            setLinkAnchorElement(true)
            if (selectedLinkUrl) setLinkOperatorShow(true)
            else setLinkOperatorShow(false)
          } else {
            setLinkAnchorElement()
            setLinkOperatorShow(false)
          }
        })
      }),
      editor.registerCommand(
        CLICK_COMMAND,
        (payload) => {
          schedule(() => {
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
              if (selectedLinkUrl) setLinkOperatorShow(true)
              else setLinkOperatorShow(false)
            } else {
              setLinkAnchorElement()
              setLinkOperatorShow(false)
            }
          })
          return !!getClickedLinkElement(payload.target)
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, noteEditorStore])
}
export const useLink = () => {
  const { t } = useTranslation(['workflow'])
  const [editor] = useLexicalComposerContext()
  const noteEditorStore = useNoteEditorStore()
  const handleSaveLink = useCallback(
    (url: string) => {
      if (url && !urlRegExp.test(url)) {
        toast.error(t(($) => $['nodes.note.editor.invalidUrl'], { ns: 'workflow' }))
        return
      }
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
      const { setLinkAnchorElement } = noteEditorStore.getState()
      setLinkAnchorElement()
    },
    [editor, noteEditorStore, t],
  )
  const handleUnlink = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    const { setLinkAnchorElement } = noteEditorStore.getState()
    setLinkAnchorElement()
  }, [editor, noteEditorStore])
  const restoreEditorFocus = useCallback(() => {
    editor.focus()
  }, [editor])
  return {
    handleSaveLink,
    handleUnlink,
    restoreEditorFocus,
  }
}
