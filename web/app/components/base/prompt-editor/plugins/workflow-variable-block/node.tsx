import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import WorkflowVariableBlockComponent from './component'
import type { Node } from '@/app/components/workflow/types'

type GetWorkflowNode = (nodeId: string) => Node | undefined
export type SerializedNode = SerializedLexicalNode & {
  variables: string[]
  getWorkflowNode: GetWorkflowNode
}

export class WorkflowVariableBlockNode extends DecoratorNode<JSX.Element> {
  __variables: string[]
  __getWorkflowNode: GetWorkflowNode

  static getType(): string {
    return 'workflow-variable-block'
  }

  static clone(node: WorkflowVariableBlockNode): WorkflowVariableBlockNode {
    return new WorkflowVariableBlockNode(node.__variables, node.__getWorkflowNode)
  }

  isInline(): boolean {
    return true
  }

  constructor(variables: string[], getWorkflowNode: GetWorkflowNode, key?: NodeKey) {
    super(key)

    this.__variables = variables
    this.__getWorkflowNode = getWorkflowNode
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'items-center', 'align-middle')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): JSX.Element {
    return (
      <WorkflowVariableBlockComponent
        nodeKey={this.getKey()}
        variables={this.__variables}
        getWorkflowNode={this.__getWorkflowNode}
      />
    )
  }

  static importJSON(serializedNode: SerializedNode): WorkflowVariableBlockNode {
    const node = $createWorkflowVariableBlockNode(serializedNode.variables, serializedNode.getWorkflowNode)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'workflow-variable-block',
      version: 1,
      variables: this.__variables,
      getWorkflowNode: this.__getWorkflowNode,
    }
  }

  getTextContent(): string {
    return `{{#${this.__variables.join('.')}#}}`
  }
}
export function $createWorkflowVariableBlockNode(variables: string[], getWorkflowNodeName: (nodeId: string) => Node | undefined): WorkflowVariableBlockNode {
  return new WorkflowVariableBlockNode(variables, getWorkflowNodeName)
}

export function $isWorkflowVariableBlockNode(
  node: WorkflowVariableBlockNode | LexicalNode | null | undefined,
): node is WorkflowVariableBlockNode {
  return node instanceof WorkflowVariableBlockNode
}
