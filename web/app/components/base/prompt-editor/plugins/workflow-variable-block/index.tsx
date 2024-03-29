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
import type { WorkflowVariableBlockType } from '../../types'
import {
  $createWorkflowVariableBlockNode,
  WorkflowVariableBlockNode,
} from './node'
import type { Node } from '@/app/components/workflow/types'

export const INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND = createCommand('INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND')
export const DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND = createCommand('DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND')

export type WorkflowVariableBlockProps = {
  getWorkflowNode: (nodeId: string) => Node
  onInsert?: () => void
  onDelete?: () => void
}
const WorkflowVariableBlock = memo(({
  getWorkflowNode = () => undefined,
  onInsert,
  onDelete,
}: WorkflowVariableBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
        (variables: string[]) => {
          const contextBlockNode = $createWorkflowVariableBlockNode(variables, getWorkflowNode)

          $insertNodes([contextBlockNode])
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
  }, [editor, onInsert, onDelete, getWorkflowNode])

  return null
})
WorkflowVariableBlock.displayName = 'WorkflowVariableBlock'

export { WorkflowVariableBlock }
export { WorkflowVariableBlockNode } from './node'
export { default as WorkflowVariableBlockReplacementBlock } from './workflow-variable-block-replacement-block'
