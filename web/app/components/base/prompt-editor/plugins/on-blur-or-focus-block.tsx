import type { FC } from 'react'
import { useEffect } from 'react'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

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
        () => {
          if (onBlur)
            onBlur()

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
