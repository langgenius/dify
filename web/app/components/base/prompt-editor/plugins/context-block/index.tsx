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
  $createContextBlockNode,
  ContextBlockNode,
} from './node'

export const INSERT_CONTEXT_BLOCK_COMMAND = createCommand('INSERT_CONTEXT_BLOCK_COMMAND')
export const DELETE_CONTEXT_BLOCK_COMMAND = createCommand('DELETE_CONTEXT_BLOCK_COMMAND')

export type Dataset = {
  id: string
  name: string
  type: string
}

export type ContextBlockProps = {
  datasets: Dataset[]
  onAddContext: () => void
  onInsert?: () => void
  onDelete?: () => void
}
const ContextBlock: FC<ContextBlockProps> = ({
  datasets,
  onAddContext,
  onInsert,
  onDelete,
}) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockPlugin: ContextBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_CONTEXT_BLOCK_COMMAND,
        () => {
          const contextBlockNode = $createContextBlockNode(datasets, onAddContext)

          $insertNodes([contextBlockNode])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_CONTEXT_BLOCK_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, datasets, onAddContext, onInsert, onDelete])

  return null
}

export default ContextBlock
