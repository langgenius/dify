import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { $getRoot, $nodesOfType } from 'lexical'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createLexicalTestEditor } from '../../__tests__/test-helpers'
import { $createWorkflowVariableBlockNode, WorkflowVariableBlockNode } from '../node'

it('restores the variable selector, node display metadata and available variables from saved editor content', () => {
  const editor = createLexicalTestEditor('variable-save', [WorkflowVariableBlockNode])
  const nodes = { 'node-1': { title: 'Answer', type: BlockEnum.LLM } }
  const availableVariables: NodeOutPutVar[] = [
    { nodeId: 'node-1', title: 'Answer', vars: [{ variable: 'answer', type: VarType.string }] },
  ]
  editor.update(
    () => {
      $getRoot().append(
        $createWorkflowVariableBlockNode(
          ['node-1', 'answer'],
          nodes,
          undefined,
          availableVariables,
        ),
      )
    },
    { discrete: true },
  )
  const saved = JSON.stringify(editor.getEditorState())
  const restored = createLexicalTestEditor('variable-restore', [WorkflowVariableBlockNode])
  restored.setEditorState(restored.parseEditorState(saved))
  restored.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('{{#node-1.answer#}}')
    const variable = $nodesOfType(WorkflowVariableBlockNode)[0]!
    expect(variable.getVariables()).toEqual(['node-1', 'answer'])
    expect(variable.getWorkflowNodesMap()).toEqual(nodes)
    expect(variable.getAvailableVariables()).toEqual(availableVariables)
  })
})
