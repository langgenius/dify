import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { GetVarType, WorkflowVariableBlockType } from '../../types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { DecoratorNode } from 'lexical'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowVariableBlockComponent from './component'

export type WorkflowNodesMap = WorkflowVariableBlockType['workflowNodesMap']

export type SerializedNode = SerializedLexicalNode & {
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  getVarType?: GetVarType
  nodeOutputVars?: NodeOutPutVar[]
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
}

export class WorkflowVariableBlockNode extends DecoratorNode<React.JSX.Element> {
  __variables: string[]
  __workflowNodesMap: WorkflowNodesMap
  __getVarType?: GetVarType
  __nodeOutputVars?: NodeOutPutVar[]
  __environmentVariables?: Var[]
  __conversationVariables?: Var[]
  __ragVariables?: Var[]

  static getType(): string {
    return 'workflow-variable-block'
  }

  static clone(node: WorkflowVariableBlockNode): WorkflowVariableBlockNode {
    return new WorkflowVariableBlockNode(node.__variables, node.__workflowNodesMap, node.__getVarType, node.__key, node.__environmentVariables, node.__conversationVariables, node.__ragVariables, node.__nodeOutputVars)
  }

  isInline(): boolean {
    return true
  }

  constructor(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType: any, key?: NodeKey, environmentVariables?: Var[], conversationVariables?: Var[], ragVariables?: Var[], nodeOutputVars?: NodeOutPutVar[]) {
    super(key)

    this.__variables = variables
    this.__workflowNodesMap = workflowNodesMap
    this.__getVarType = getVarType
    this.__environmentVariables = environmentVariables
    this.__conversationVariables = conversationVariables
    this.__ragVariables = ragVariables
    this.__nodeOutputVars = nodeOutputVars
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
        nodeOutputVars={this.__nodeOutputVars}
        getVarType={this.__getVarType!}
        environmentVariables={this.__environmentVariables}
        conversationVariables={this.__conversationVariables}
        ragVariables={this.__ragVariables}
      />
    )
  }

  static importJSON(serializedNode: SerializedNode): WorkflowVariableBlockNode {
    const node = $createWorkflowVariableBlockNode(serializedNode.variables, serializedNode.workflowNodesMap, serializedNode.getVarType, serializedNode.environmentVariables, serializedNode.conversationVariables, serializedNode.ragVariables, serializedNode.nodeOutputVars)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'workflow-variable-block',
      version: 1,
      variables: this.getVariables(),
      workflowNodesMap: this.getWorkflowNodesMap(),
      getVarType: this.getVarType(),
      nodeOutputVars: this.getNodeOutputVars(),
      environmentVariables: this.getEnvironmentVariables(),
      conversationVariables: this.getConversationVariables(),
      ragVariables: this.getRagVariables(),
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

  getNodeOutputVars(): NodeOutPutVar[] {
    const self = this.getLatest()
    return self.__nodeOutputVars || []
  }

  getEnvironmentVariables(): any {
    const self = this.getLatest()
    return self.__environmentVariables
  }

  getConversationVariables(): any {
    const self = this.getLatest()
    return self.__conversationVariables
  }

  getRagVariables(): any {
    const self = this.getLatest()
    return self.__ragVariables
  }

  getTextContent(): string {
    const variables = this.getVariables()
    const node = this.getWorkflowNodesMap()?.[variables[0]]
    const isContextVariable = (node?.type === BlockEnum.Agent || node?.type === BlockEnum.LLM)
      && variables[variables.length - 1] === 'context'
    const marker = isContextVariable ? '@' : '#'
    return `{{${marker}${variables.join('.')}${marker}}}`
  }
}
export function $createWorkflowVariableBlockNode(variables: string[], workflowNodesMap: WorkflowNodesMap, getVarType?: GetVarType, environmentVariables?: Var[], conversationVariables?: Var[], ragVariables?: Var[], nodeOutputVars?: NodeOutPutVar[]): WorkflowVariableBlockNode {
  return new WorkflowVariableBlockNode(variables, workflowNodesMap, getVarType, undefined, environmentVariables, conversationVariables, ragVariables, nodeOutputVars)
}

export function $isWorkflowVariableBlockNode(
  node: WorkflowVariableBlockNode | LexicalNode | null | undefined,
): node is WorkflowVariableBlockNode {
  return node instanceof WorkflowVariableBlockNode
}
