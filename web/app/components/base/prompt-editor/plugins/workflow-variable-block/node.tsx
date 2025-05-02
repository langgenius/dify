import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import type { WorkflowVariableBlockType } from '../../types'
import WorkflowVariableBlockComponent from './component'
import type { GetVarType } from '../../types'

export type WorkflowNodesMap = WorkflowVariableBlockType['workflowNodesMap']

export type SerializedNode = SerializedLexicalNode & {
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  getVarType?: GetVarType
}

export class WorkflowVariableBlockNode extends DecoratorNode<React.JSX.Element> {
  __variables: string[]
  __workflowNodesMap: WorkflowNodesMap
  __getVarType?: GetVarType

  static getType(): string {
    return 'workflow-variable-block'
  }

  static clone(node: WorkflowVariableBlockNode): WorkflowVariableBlockNode {
    return new WorkflowVariableBlockNode(node.__variables, node.__workflowNodesMap, node.__getVarType, node.__key)
  }

  isInline(): boolean {
    return true
  }

  constructor(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType: any, key?: NodeKey) {
    super(key)

    this.__variables = variables
    this.__workflowNodesMap = workflowNodesMap
    this.__getVarType = getVarType
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'items-center', 'align-middle')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <WorkflowVariableBlockComponent
        nodeKey={this.getKey()}
        variables={this.__variables}
        workflowNodesMap={this.__workflowNodesMap}
        getVarType={this.__getVarType!}
      />
    )
  }

  static importJSON(serializedNode: SerializedNode): WorkflowVariableBlockNode {
    const node = $createWorkflowVariableBlockNode(serializedNode.variables, serializedNode.workflowNodesMap, serializedNode.getVarType)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'workflow-variable-block',
      version: 1,
      variables: this.getVariables(),
      workflowNodesMap: this.getWorkflowNodesMap(),
      getVarType: this.getVarType(),
    }
  }

  getVariables(): string[] {
    const self = this.getLatest()
    return self.__variables
  }

  getWorkflowNodesMap(): WorkflowNodesMap {
    const self = this.getLatest()
    return self.__workflowNodesMap
  }

  getVarType(): any {
    const self = this.getLatest()
    return self.__getVarType
  }

  getTextContent(): string {
    return `{{#${this.getVariables().join('.')}#}}`
  }
}
export function $createWorkflowVariableBlockNode(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType?: GetVarType): WorkflowVariableBlockNode {
  return new WorkflowVariableBlockNode(variables, workflowNodesMap, getVarType)
}

export function $isWorkflowVariableBlockNode(
  node: WorkflowVariableBlockNode | LexicalNode | null | undefined,
): node is WorkflowVariableBlockNode {
  return node instanceof WorkflowVariableBlockNode
}
