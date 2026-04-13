import type { WorkflowVariableBlockType } from '../../types'
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
export type UpdateWorkflowNodesMapPayload = {
  workflowNodesMap: NonNullable<WorkflowVariableBlockType['workflowNodesMap']>
  availableVariables: NonNullable<WorkflowVariableBlockType['variables']>
}
export const UPDATE_WORKFLOW_NODES_MAP = createCommand<UpdateWorkflowNodesMapPayload>('UPDATE_WORKFLOW_NODES_MAP')
const WorkflowVariableBlock = memo(({
  workflowNodesMap = {},
  variables: workflowAvailableVariables,
  onInsert,
  onDelete,
  getVarType,
}: WorkflowVariableBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.update(() => {
      editor.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, {
        workflowNodesMap: workflowNodesMap || {},
        availableVariables: workflowAvailableVariables || [],
      })
    })
  }, [editor, workflowNodesMap, workflowAvailableVariables])

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
        (variables: string[]) => {
          const workflowVariableBlockNode = $createWorkflowVariableBlockNode(
            variables,
            workflowNodesMap,
            getVarType,
            workflowAvailableVariables || [],
          )

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
  }, [editor, onInsert, onDelete, workflowNodesMap, getVarType, workflowAvailableVariables])

  return null
})
WorkflowVariableBlock.displayName = 'WorkflowVariableBlock'

export { WorkflowVariableBlock }
export { WorkflowVariableBlockNode } from './node'
export { default as WorkflowVariableBlockReplacementBlock } from './workflow-variable-block-replacement-block'
