import {
  memo,
  useEffect,
} from 'react'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { QueryBlockType } from '../../types'
import type {
  HITLNodeProps,
} from './node'
import {
  $createHITLInputNode,
  HITLInputNode,
} from './node'
import { mergeRegister } from '@lexical/utils'

export const INSERT_HITL_INPUT_BLOCK_COMMAND = createCommand('INSERT_HITL_INPUT_BLOCK_COMMAND')
export const DELETE_HITL_INPUT_BLOCK_COMMAND = createCommand('DELETE_HITL_INPUT_BLOCK_COMMAND')

export type HITLInputProps = {
  onInsert?: () => void
  onDelete?: () => void
}
const HITLInputBlock = memo(({
  onInsert,
  onDelete,
}: QueryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([HITLInputNode]))
      throw new Error('HITLInputBlockPlugin: HITLInputBlock not registered on editor')
    return mergeRegister(
      editor.registerCommand(
        INSERT_HITL_INPUT_BLOCK_COMMAND,
        (nodeProps: HITLNodeProps) => {
          const {
            variableName,
            nodeId,
            nodeTitle,
            formInputs,
            onFormInputsChange,
            onFormInputItemRename,
            onFormInputItemRemove,
          } = nodeProps
          const currentHITLNode = $createHITLInputNode(
            variableName,
            nodeId,
            nodeTitle,
            formInputs,
            onFormInputsChange,
            onFormInputItemRename,
            onFormInputItemRemove,
          )

          $insertNodes([currentHITLNode])

          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_HITL_INPUT_BLOCK_COMMAND,
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

HITLInputBlock.displayName = 'HITLInputBlock'

export { HITLInputBlock }
export { HITLInputNode } from './node'
export { default as HITLInputBlockReplacementBlock } from './hitl-input-block-replacement-block'
