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
import type { HITLInputBlockType } from '../../types'
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
export const UPDATE_WORKFLOW_NODES_MAP = createCommand('UPDATE_WORKFLOW_NODES_MAP')

export type HITLInputProps = {
  onInsert?: () => void
  onDelete?: () => void
}
const HITLInputBlock = memo(({
  onInsert,
  onDelete,
  workflowNodesMap,
  getVarType,
}: HITLInputBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.update(() => {
      editor.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, workflowNodesMap)
    })
  }, [editor, workflowNodesMap])

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
            formInputs,
            onFormInputsChange,
            onFormInputItemRename,
            onFormInputItemRemove,
          } = nodeProps
          const currentHITLNode = $createHITLInputNode(
            variableName,
            nodeId,
            formInputs,
            onFormInputsChange,
            onFormInputItemRename,
            onFormInputItemRemove,
            workflowNodesMap,
            getVarType,
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
