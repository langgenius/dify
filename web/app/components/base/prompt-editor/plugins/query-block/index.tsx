import type { QueryBlockType } from '../../types'
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
  $createQueryBlockNode,
  QueryBlockNode,
} from './node'

export const INSERT_QUERY_BLOCK_COMMAND = createCommand('INSERT_QUERY_BLOCK_COMMAND')
export const DELETE_QUERY_BLOCK_COMMAND = createCommand('DELETE_QUERY_BLOCK_COMMAND')

export type QueryBlockProps = {
  onInsert?: () => void
  onDelete?: () => void
}
const QueryBlock = memo(({
  onInsert,
  onDelete,
}: QueryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([QueryBlockNode]))
      throw new Error('QueryBlockPlugin: QueryBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_QUERY_BLOCK_COMMAND,
        () => {
          const contextBlockNode = $createQueryBlockNode()

          $insertNodes([contextBlockNode])
          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_QUERY_BLOCK_COMMAND,
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
QueryBlock.displayName = 'QueryBlock'

export { QueryBlock }
export { QueryBlockNode } from './node'
export { default as QueryBlockReplacementBlock } from './query-block-replacement-block'
