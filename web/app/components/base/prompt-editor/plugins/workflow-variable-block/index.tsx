import type { GetVarType, WorkflowVariableBlockType } from '../../types'
import type { Node } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import {
  memo,
  useEffect,
} from 'react'
import {
  $createWorkflowVariableBlockNode,
  WorkflowVariableBlockNode,
} from './node'

export const INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND = createCommand('INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND')
export const DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND = createCommand('DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND')
export const CLEAR_HIDE_MENU_TIMEOUT = createCommand('CLEAR_HIDE_MENU_TIMEOUT')
export const UPDATE_WORKFLOW_NODES_MAP = createCommand('UPDATE_WORKFLOW_NODES_MAP')

export type WorkflowVariableBlockProps = {
  getWorkflowNode: (nodeId: string) => Node
  onInsert?: () => void
  onDelete?: () => void
  getVarType: GetVarType
}
const WorkflowVariableBlock = memo(({
  workflowNodesMap,
  onInsert,
  onDelete,
  getVarType,
}: WorkflowVariableBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.update(() => {
      editor.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, workflowNodesMap)
    })
  }, [editor, workflowNodesMap])

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
        (variables: string[]) => {
          editor.dispatchCommand(CLEAR_HIDE_MENU_TIMEOUT, undefined)
          const workflowVariableBlockNode = $createWorkflowVariableBlockNode(variables, workflowNodesMap, getVarType)

          $insertNodes([workflowVariableBlockNode])
          if (onInsert)
            onInsert()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
        () => {
          if (onDelete)
            onDelete()

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onInsert, onDelete, workflowNodesMap, getVarType])

  return null
})
WorkflowVariableBlock.displayName = 'WorkflowVariableBlock'

export { WorkflowVariableBlock }
export { WorkflowVariableBlockNode } from './node'
export { default as WorkflowVariableBlockReplacementBlock } from './workflow-variable-block-replacement-block'
