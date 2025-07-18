import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import type { WorkflowVariableBlockType } from '../../types'
import WorkflowVariableBlockComponent from './component'
import type { GetVarType } from '../../types'
import type { Var } from '@/app/components/workflow/types'

export type WorkflowNodesMap = WorkflowVariableBlockType['workflowNodesMap']

export type SerializedNode = SerializedLexicalNode & {
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  getVarType?: GetVarType
  environmentVariables?: Var[]
  conversationVariables?: Var[]
}

export class WorkflowVariableBlockNode extends DecoratorNode<React.JSX.Element> {
  __variables: string[]
  __workflowNodesMap: WorkflowNodesMap
  __getVarType?: GetVarType
  __environmentVariables?: Var[]
  __conversationVariables?: Var[]

  static getType(): string {
    return 'workflow-variable-block'
  }

  static clone(node: WorkflowVariableBlockNode): WorkflowVariableBlockNode {
    return new WorkflowVariableBlockNode(node.__variables, node.__workflowNodesMap, node.__getVarType, node.__key, node.__environmentVariables, node.__conversationVariables)
  }

  isInline(): boolean {
    return true
  }

  constructor(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType: any, key?: NodeKey, environmentVariables?: Var[], conversationVariables?: Var[]) {
    super(key)

    this.__variables = variables
    this.__workflowNodesMap = workflowNodesMap
    this.__getVarType = getVarType
    this.__environmentVariables = environmentVariables
    this.__conversationVariables = conversationVariables
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
        environmentVariables={this.__environmentVariables}
        conversationVariables={this.__conversationVariables}
      />
    )
  }

  static importJSON(serializedNode: SerializedNode): WorkflowVariableBlockNode {
    const node = $createWorkflowVariableBlockNode(serializedNode.variables, serializedNode.workflowNodesMap, serializedNode.getVarType, serializedNode.environmentVariables, serializedNode.conversationVariables)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'workflow-variable-block',
      version: 1,
      variables: this.getVariables(),
      workflowNodesMap: this.getWorkflowNodesMap(),
      getVarType: this.getVarType(),
      environmentVariables: this.getEnvironmentVariables(),
      conversationVariables: this.getConversationVariables(),
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

  getEnvironmentVariables(): any {
    const self = this.getLatest()
    return self.__environmentVariables
  }

  getConversationVariables(): any {
    const self = this.getLatest()
    return self.__conversationVariables
  }

  getTextContent(): string {
    return `{{#${this.getVariables().join('.')}#}}`
  }
}
export function $createWorkflowVariableBlockNode(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType?: GetVarType, environmentVariables?: Var[], conversationVariables?: Var[]): WorkflowVariableBlockNode {
  return new WorkflowVariableBlockNode(variables, workflowNodesMap, getVarType, undefined, environmentVariables, conversationVariables)
}

export function $isWorkflowVariableBlockNode(
  node: WorkflowVariableBlockNode | LexicalNode | null | undefined,
): node is WorkflowVariableBlockNode {
  return node instanceof WorkflowVariableBlockNode
}
