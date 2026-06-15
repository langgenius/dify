import type { RequestURLBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import {
  memo,
  useEffect,
} from 'react'
import {
  $createRequestURLBlockNode,
  RequestURLBlockNode,
} from './node'

export const INSERT_REQUEST_URL_BLOCK_COMMAND = createCommand('INSERT_REQUEST_URL_BLOCK_COMMAND')
export const DELETE_REQUEST_URL_BLOCK_COMMAND = createCommand('DELETE_REQUEST_URL_BLOCK_COMMAND')

const RequestURLBlock = memo(({
  onInsert,
  onDelete,
}: RequestURLBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([RequestURLBlockNode]))
      throw new Error('RequestURLBlockPlugin: RequestURLBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_REQUEST_URL_BLOCK_COMMAND,
        () => {
          const contextBlockNode = $createRequestURLBlockNode()

          $insertNodes([contextBlockNode])
          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_REQUEST_URL_BLOCK_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onInsert, onDelete])

  return null
})
RequestURLBlock.displayName = 'RequestURLBlock'

export { RequestURLBlock }
export { RequestURLBlockNode } from './node'
export { default as RequestURLBlockReplacementBlock } from './request-url-block-replacement-block'
