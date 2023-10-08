import type { FC } from 'react'
import { useEffect } from 'react'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createHistoryBlockNode,
  HistoryBlockNode,
} from './node'

export const INSERT_HISTORY_BLOCK_COMMAND = createCommand()

export type RoleName = {
  user: string
  assistant: string
}

type HistoryBlockProps = {
  roleName: RoleName
}

const HistoryBlock: FC<HistoryBlockProps> = ({
  roleName,
}) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([HistoryBlockNode]))
      throw new Error('HistoryBlockPlugin: HistoryBlock not registered on editor')

    return editor.registerCommand(
      INSERT_HISTORY_BLOCK_COMMAND,
      () => {
        const historyBlockNode = $createHistoryBlockNode(roleName)

        $insertNodes([historyBlockNode])

        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor, roleName])

  return null
}

export default HistoryBlock
