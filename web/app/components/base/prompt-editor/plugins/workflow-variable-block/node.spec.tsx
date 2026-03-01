import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import type { Var } from '@/app/components/workflow/types'
import { createEditor } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  $createWorkflowVariableBlockNode,
  $isWorkflowVariableBlockNode,
  WorkflowVariableBlockNode,
} from './node'

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
      const environmentVariables: Var[] = [{ variable: 'env.key', type: VarType.string }]
      const conversationVariables: Var[] = [{ variable: 'conversation.topic', type: VarType.string }]
      const ragVariables: Var[] = [{ variable: 'rag.shared.answer', type: VarType.string }]

      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        'decorator-key',
        environmentVariables,
        conversationVariables,
        ragVariables,
      )

      const decorated = node.decorate()
      expect(decorated.props.nodeKey).toBe('decorator-key')
      expect(decorated.props.variables).toEqual(['node-1', 'answer'])
      expect(decorated.props.workflowNodesMap).toEqual({ 'node-1': { title: 'A', type: BlockEnum.LLM } })
      expect(decorated.props.environmentVariables).toEqual(environmentVariables)
      expect(decorated.props.conversationVariables).toEqual(conversationVariables)
      expect(decorated.props.ragVariables).toEqual(ragVariables)
    })
  })

  it('should export and import json with full payload', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.string)
      const environmentVariables: Var[] = [{ variable: 'env.key', type: VarType.string }]
      const conversationVariables: Var[] = [{ variable: 'conversation.topic', type: VarType.string }]
      const ragVariables: Var[] = [{ variable: 'rag.shared.answer', type: VarType.string }]

      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        undefined,
        environmentVariables,
        conversationVariables,
        ragVariables,
      )

      expect(node.exportJSON()).toEqual({
        type: 'workflow-variable-block',
        version: 1,
        variables: ['node-1', 'answer'],
        workflowNodesMap: { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        environmentVariables,
        conversationVariables,
        ragVariables,
      })

      const imported = WorkflowVariableBlockNode.importJSON({
        type: 'workflow-variable-block',
        version: 1,
        variables: ['node-2', 'result'],
        workflowNodesMap: { 'node-2': { title: 'B', type: BlockEnum.Tool } },
        getVarType,
        environmentVariables,
        conversationVariables,
        ragVariables,
      })

      expect(imported).toBeInstanceOf(WorkflowVariableBlockNode)
      expect(imported.getVariables()).toEqual(['node-2', 'result'])
      expect(imported.getWorkflowNodesMap()).toEqual({ 'node-2': { title: 'B', type: BlockEnum.Tool } })
    })
  })

  it('should return getters and text content in expected format', () => {
    runInEditor(() => {
      const getVarType = vi.fn(() => Type.string)
      const environmentVariables: Var[] = [{ variable: 'env.key', type: VarType.string }]
      const conversationVariables: Var[] = [{ variable: 'conversation.topic', type: VarType.string }]
      const ragVariables: Var[] = [{ variable: 'rag.shared.answer', type: VarType.string }]
      const node = new WorkflowVariableBlockNode(
        ['node-1', 'answer'],
        { 'node-1': { title: 'A', type: BlockEnum.LLM } },
        getVarType,
        undefined,
        environmentVariables,
        conversationVariables,
        ragVariables,
      )

      expect(node.getVariables()).toEqual(['node-1', 'answer'])
      expect(node.getWorkflowNodesMap()).toEqual({ 'node-1': { title: 'A', type: BlockEnum.LLM } })
      expect(node.getVarType()).toBe(getVarType)
      expect(node.getEnvironmentVariables()).toEqual(environmentVariables)
      expect(node.getConversationVariables()).toEqual(conversationVariables)
      expect(node.getRagVariables()).toEqual(ragVariables)
      expect(node.getTextContent()).toBe('{{#node-1.answer#}}')
    })
  })

  it('should create node helper and type guard checks', () => {
    runInEditor(() => {
      const node = $createWorkflowVariableBlockNode(['node-1', 'answer'], {}, undefined)

      expect(node).toBeInstanceOf(WorkflowVariableBlockNode)
      expect($isWorkflowVariableBlockNode(node)).toBe(true)
      expect($isWorkflowVariableBlockNode(null)).toBe(false)
      expect($isWorkflowVariableBlockNode(undefined)).toBe(false)
      expect($isWorkflowVariableBlockNode({} as LexicalNode)).toBe(false)
    })
  })
})
