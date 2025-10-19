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
import type { LastRunBlockType } from '../../types'
import {
  $createLastRunBlockNode,
  LastRunBlockNode,
} from './node'

export const INSERT_LAST_RUN_BLOCK_COMMAND = createCommand('INSERT_LAST_RUN_BLOCK_COMMAND')
export const DELETE_LAST_RUN_COMMAND = createCommand('DELETE_LAST_RUN_COMMAND')

const LastRunBlock = memo(({
  onInsert,
  onDelete,
}: LastRunBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([LastRunBlockNode]))
      throw new Error('Last_RunBlockPlugin: Last_RunBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_LAST_RUN_BLOCK_COMMAND,
        () => {
          const Node = $createLastRunBlockNode()

          $insertNodes([Node])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_LAST_RUN_COMMAND,
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
LastRunBlock.displayName = 'LastRunBlock'

export { LastRunBlock }
export { LastRunBlockNode } from './node'
export { default as LastRunReplacementBlock } from './last-run-block-replacement-block'
