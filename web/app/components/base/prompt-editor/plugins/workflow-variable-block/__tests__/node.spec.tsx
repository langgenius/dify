import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { createEditor } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  $createWorkflowVariableBlockNode,
  $isWorkflowVariableBlockNode,
  WorkflowVariableBlockNode,
} from '../node'

describe('WorkflowVariableBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [WorkflowVariableBlockNode as unknown as Klass<LexicalNode>],
    })
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should expose type and clone with same payload', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.string)
      const original = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        'node-key',
      )
      const cloned = WorkflowVariableBlockNode.clone(original)

      expect(WorkflowVariableBlockNode.getType()).toBe('workflow-variable-block')
      expect(cloned).toBeInstanceOf(WorkflowVariableBlockNode)
      expect(cloned.getKey()).toBe(original.getKey())
    })
  })

  it('should be inline and create expected dom classes', () => {
    runInEditor(() => {
      const node = new WorkflowVariableBlockNode(['node-1', 'answer'], {}, undefined)
      const dom = node.createDOM()

      expect(node.isInline()).toBe(true)
      expect(dom.tagName).toBe('DIV')
      expect(dom).toHaveClass('inline-flex')
      expect(dom).toHaveClass('items-center')
      expect(dom).toHaveClass('align-middle')
      expect(node.updateDOM()).toBe(false)
    })
  })

  it('should decorate with component props from node state', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.number)
      const availableVariables: NodeOutPutVar[] = [{
        nodeId: 'node-1',
        title: 'Node A',
        vars: [{ variable: 'answer', type: VarType.string }],
      }]

      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        'decorator-key',
        availableVariables,
      )

      const decorated = node.decorate()
      expect(decorated.props.nodeKey).toBe('decorator-key')
      expect(decorated.props.variables).toEqual(['node-1', 'answer'])
      expect(decorated.props.workflowNodesMap).toEqual({ 'node-1': { title: 'A', type: BlockEnum.LLM } })
      expect(decorated.props.availableVariables).toEqual(availableVariables)
    })
  })

  it('should export and import json with available variables payload', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.string)
      const availableVariables: NodeOutPutVar[] = [{
        nodeId: 'node-1',
        title: 'Node A',
        vars: [{ variable: 'answer', type: VarType.string }],
      }]

      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        undefined,
        availableVariables,
      )

      expect(node.exportJSON()).toEqual({
        type: 'workflow-variable-block',
        version: 1,
        variables: ['node-1', 'answer'],
        workflowNodesMap: { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        availableVariables,
      })

      const imported = WorkflowVariableBlockNode.importJSON({
        type: 'workflow-variable-block',
        version: 1,
        variables: ['node-2', 'result'],
        workflowNodesMap: { 'node-2': { title: 'B', type: BlockEnum.Tool } },
        getVarType,
        availableVariables,
      })

      expect(imported).toBeInstanceOf(WorkflowVariableBlockNode)
      expect(imported.getVariables()).toEqual(['node-2', 'result'])
      expect(imported.getWorkflowNodesMap()).toEqual({ 'node-2': { title: 'B', type: BlockEnum.Tool } })
      expect(imported.getAvailableVariables()).toEqual(availableVariables)
    })
  })

  it('should return getters and text content in expected format', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.string)
      const availableVariables: NodeOutPutVar[] = [{
        nodeId: 'node-1',
        title: 'Node A',
        vars: [{ variable: 'answer', type: VarType.string }],
      }]
      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        undefined,
        availableVariables,
      )

      expect(node.getVariables()).toEqual(['node-1', 'answer'])
      expect(node.getWorkflowNodesMap()).toEqual({ 'node-1': { title: 'A', type: BlockEnum.LLM } })
      expect(node.getVarType()).toBe(getVarType)
      expect(node.getAvailableVariables()).toEqual(availableVariables)
      expect(node.getTextContent()).toBe('{{#node-1.answer#}}')
    })
  })

  it('should create node helper and type guard checks', () => {
    runInEditor(() => {
      const availableVariables: NodeOutPutVar[] = [{
        nodeId: 'node-1',
        title: 'Node A',
        vars: [{ variable: 'answer', type: VarType.string }],
      }]
      const node = $createWorkflowVariableBlockNode(['node-1', 'answer'], {}, undefined, availableVariables)

      expect(node).toBeInstanceOf(WorkflowVariableBlockNode)
      expect(node.getAvailableVariables()).toEqual(availableVariables)
      expect($isWorkflowVariableBlockNode(node)).toBe(true)
      expect($isWorkflowVariableBlockNode(null)).toBe(false)
      expect($isWorkflowVariableBlockNode(undefined)).toBe(false)
      expect($isWorkflowVariableBlockNode({} as LexicalNode)).toBe(false)
    })
  })
})
