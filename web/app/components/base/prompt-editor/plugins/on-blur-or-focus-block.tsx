import type { FC } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import { useEffect, useRef } from 'react'
import { CLEAR_HIDE_MENU_TIMEOUT } from './workflow-variable-block'

type OnBlurBlockProps = {
  onBlur?: () => void
  onFocus?: () => void
}
const OnBlurBlock: FC<OnBlurBlockProps> = ({
  onBlur,
  onFocus,
}) => {
  const [editor] = useLexicalComposerContext()

  const ref = useRef<any>(null)

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLEAR_HIDE_MENU_TIMEOUT,
        () => {
          if (ref.current) {
            clearTimeout(ref.current)
            ref.current = null
          }
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        (event) => {
          // Check if the clicked target element is var-search-input
          const target = event?.relatedTarget as HTMLElement
          if (!target?.classList?.contains('var-search-input')) {
            ref.current = setTimeout(() => {
              editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }))
            }, 200)
            if (onBlur)
              onBlur()
          }
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          if (onFocus)
            onFocus()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onBlur, onFocus])

  return null
}

export default OnBlurBlock
