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
import type { HistoryBlockType } from '../../types'
import {
  $createHistoryBlockNode,
  HistoryBlockNode,
} from './node'

export const INSERT_HISTORY_BLOCK_COMMAND = createCommand('INSERT_HISTORY_BLOCK_COMMAND')
export const DELETE_HISTORY_BLOCK_COMMAND = createCommand('DELETE_HISTORY_BLOCK_COMMAND')

export type RoleName = {
  user: string
  assistant: string
}

export type HistoryBlockProps = {
  roleName: RoleName
  onEditRole: () => void
  onInsert?: () => void
  onDelete?: () => void
}

const HistoryBlock = memo(({
  history = { user: '', assistant: '' },
  onEditRole = () => {},
  onInsert,
  onDelete,
}: HistoryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([HistoryBlockNode]))
      throw new Error('HistoryBlockPlugin: HistoryBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_HISTORY_BLOCK_COMMAND,
        () => {
          const historyBlockNode = $createHistoryBlockNode(history, onEditRole)

          $insertNodes([historyBlockNode])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_HISTORY_BLOCK_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, history, onEditRole, onInsert, onDelete])

  return null
})
HistoryBlock.displayName = 'HistoryBlock'

export { HistoryBlock }
export { HistoryBlockNode } from './node'
export { default as HistoryBlockReplacementBlock } from './history-block-replacement-block'
