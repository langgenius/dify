import {
  memo,
  useEffect,
} from 'react'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { ErrorMessageBlockType } from '../../types'
import {
  $createErrorMessageBlockNode,
  ErrorMessageBlockNode,
} from './node'

export const INSERT_ERROR_MESSAGE_BLOCK_COMMAND = createCommand('INSERT_ERROR_MESSAGE_BLOCK_COMMAND')
export const DELETE_ERROR_MESSAGE_COMMAND = createCommand('DELETE_ERROR_MESSAGE_COMMAND')

const ErrorMessageBlock = memo(({
  onInsert,
  onDelete,
}: ErrorMessageBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ErrorMessageBlockNode]))
      throw new Error('ERROR_MESSAGEBlockPlugin: ERROR_MESSAGEBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_ERROR_MESSAGE_BLOCK_COMMAND,
        () => {
          const Node = $createErrorMessageBlockNode()

          $insertNodes([Node])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_ERROR_MESSAGE_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onDelete, onInsert])

  return null
})
ErrorMessageBlock.displayName = 'ErrorMessageBlock'

export { ErrorMessageBlock }
export { ErrorMessageBlockNode } from './node'
export { default as ErrorMessageBlockReplacementBlock } from './error-message-block-replacement-block'
