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
import type { ContextBlockType } from '../../types'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from './node'
import { noop } from 'lodash-es'

export const INSERT_CONTEXT_BLOCK_COMMAND = createCommand('INSERT_CONTEXT_BLOCK_COMMAND')
export const DELETE_CONTEXT_BLOCK_COMMAND = createCommand('DELETE_CONTEXT_BLOCK_COMMAND')

export type Dataset = {
  id: string
  name: string
  type: string
}

const ContextBlock = memo(({
  datasets = [],
  onAddContext = noop,
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
