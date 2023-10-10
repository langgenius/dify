import type { FC } from 'react'
import { useEffect } from 'react'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
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
const QueryBlock: FC<QueryBlockProps> = ({
  onInsert,
  onDelete,
}) => {
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
}

export default QueryBlock
