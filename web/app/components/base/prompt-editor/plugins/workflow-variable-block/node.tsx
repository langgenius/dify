import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { GetVarType, WorkflowVariableBlockType } from '../../types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { DecoratorNode } from 'lexical'
import WorkflowVariableBlockComponent from './component'

export type WorkflowNodesMap = NonNullable<WorkflowVariableBlockType['workflowNodesMap']>

type SerializedNode = SerializedLexicalNode & {
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  getVarType?: GetVarType
  availableVariables?: NodeOutPutVar[]
}

export class WorkflowVariableBlockNode extends DecoratorNode<React.JSX.Element> {
  __variables: string[]
  __workflowNodesMap: WorkflowNodesMap
  __getVarType?: GetVarType
  __availableVariables?: NodeOutPutVar[]

  static override getType(): string {
    return 'workflow-variable-block'
  }

  static override clone(node: WorkflowVariableBlockNode): WorkflowVariableBlockNode {
    return new WorkflowVariableBlockNode(
      node.__variables,
      node.__workflowNodesMap,
      node.__getVarType,
      node.__key,
      node.__availableVariables,
    )
  }

  override isInline(): boolean {
    return true
  }

  constructor(
    variables: string[],
    workflowNodesMap: WorkflowNodesMap,
    getVarType: any,
    key?: NodeKey,
    availableVariables?: NodeOutPutVar[],
  ) {
    super(key)

    this.__variables = variables
    this.__workflowNodesMap = workflowNodesMap
    this.__getVarType = getVarType
    this.__availableVariables = availableVariables
  }

  override createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'items-center', 'align-middle')
    return div
  }

  override updateDOM(): false {
    return false
  }

  override decorate(): React.JSX.Element {
    return (
      <WorkflowVariableBlockComponent
        nodeKey={this.getKey()}
        variables={this.__variables}
        workflowNodesMap={this.__workflowNodesMap}
        getVarType={this.__getVarType!}
        availableVariables={this.__availableVariables}
      />
    )
  }

  static override importJSON(serializedNode: SerializedNode): WorkflowVariableBlockNode {
    const node = $createWorkflowVariableBlockNode(
      serializedNode.variables,
      serializedNode.workflowNodesMap,
      serializedNode.getVarType,
      serializedNode.availableVariables,
    )

    return node
  }

  override exportJSON(): SerializedNode {
    const json: SerializedNode = {
      type: 'workflow-variable-block',
      version: 1,
      variables: this.getVariables(),
      workflowNodesMap: this.getWorkflowNodesMap(),
      getVarType: this.getVarType(),
    }
    if (this.getAvailableVariables())
      json.availableVariables = this.getAvailableVariables()

    return json
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

  getAvailableVariables(): NodeOutPutVar[] | undefined {
    const self = this.getLatest()
    return self.__availableVariables
  }

  override getTextContent(): string {
    return `{{#${this.getVariables().join('.')}#}}`
  }
}
export function $createWorkflowVariableBlockNode(
  variables: string[],
  workflowNodesMap: WorkflowNodesMap,
  getVarType?: GetVarType,
  availableVariables?: NodeOutPutVar[],
): WorkflowVariableBlockNode {
  return new WorkflowVariableBlockNode(
    variables,
    workflowNodesMap,
    getVarType,
    undefined,
    availableVariables,
  )
}

export function $isWorkflowVariableBlockNode(
  node: WorkflowVariableBlockNode | LexicalNode | null | undefined,
): node is WorkflowVariableBlockNode {
  return node instanceof WorkflowVariableBlockNode
}
