import type { FC } from 'react'
import { useEffect } from 'react'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

type OnBlurBlockProps = {
  onBlur?: () => void
}
const OnBlurBlock: FC<OnBlurBlockProps> = ({
  onBlur,
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
    )
  }, [editor, onBlur])

  return null
}

export default OnBlurBlock
