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
import type { CurrentBlockType } from '../../types'
import {
  $createCurrentBlockNode,
  CurrentBlockNode,
} from './node'

export const INSERT_CURRENT_BLOCK_COMMAND = createCommand('INSERT_CURRENT_BLOCK_COMMAND')
export const DELETE_CURRENT_BLOCK_COMMAND = createCommand('DELETE_CURRENT_BLOCK_COMMAND')

const CurrentBlock = memo(({
  generatorType,
  onInsert,
  onDelete,
}: CurrentBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([CurrentBlockNode]))
      throw new Error('CURRENTBlockPlugin: CURRENTBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_CURRENT_BLOCK_COMMAND,
        () => {
          const currentBlockNode = $createCurrentBlockNode(generatorType)

          $insertNodes([currentBlockNode])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_CURRENT_BLOCK_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, generatorType, onDelete, onInsert])

  return null
})
CurrentBlock.displayName = 'CurrentBlock'

export { CurrentBlock }
export { CurrentBlockNode } from './node'
export { default as CurrentBlockReplacementBlock } from './current-block-replacement-block'
