import type { FC } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
} from 'lexical'
import { useEffect } from 'react'

type OnBlurBlockProps = {
  onBlur?: () => void
  onFocus?: () => void
}
const OnBlurBlock: FC<OnBlurBlockProps> = ({
  onBlur,
  onFocus,
}) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        BLUR_COMMAND,
        (event) => {
          const target = event?.relatedTarget as HTMLElement
          if (!target?.classList?.contains('var-search-input')) {
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
