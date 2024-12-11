import {
  memo,
  useEffect,
} from 'react'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { ContextBlockType } from '../../types'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from './node'

import { DELETE_CONTEXT_BLOCK_COMMAND, INSERT_CONTEXT_BLOCK_COMMAND } from './commands'

export type Dataset = {
  id: string
  name: string
  type: string
}

const ContextBlock = memo(({
  datasets = [],
  onAddContext = () => {},
  onInsert,
  onDelete,
  canNotAddContext,
}: ContextBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockPlugin: ContextBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_CONTEXT_BLOCK_COMMAND,
        () => {
          const contextBlockNode = $createContextBlockNode(datasets, onAddContext, canNotAddContext)

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
  }, [editor, datasets, onAddContext, onInsert, onDelete, canNotAddContext])

  return null
})
ContextBlock.displayName = 'ContextBlock'

export { ContextBlock }
export { ContextBlockNode } from './node'
export { default as ContextBlockReplacementBlock } from './context-block-replacement-block'
