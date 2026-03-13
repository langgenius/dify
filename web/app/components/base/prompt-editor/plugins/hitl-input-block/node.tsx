import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { GetVarType } from '../../types'
import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Var } from '@/app/components/workflow/types'
import { DecoratorNode } from 'lexical'
import HILTInputBlockComponent from './component'

export type HITLNodeProps = {
  variableName: string
  nodeId: string
  formInputs: FormInputItem[]
  onFormInputsChange: (inputs: FormInputItem[]) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onFormInputItemRemove: (varName: string) => void
  workflowNodesMap: WorkflowNodesMap
  getVarType?: GetVarType
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
  readonly?: boolean
}

export type SerializedNode = SerializedLexicalNode & HITLNodeProps

export class HITLInputNode extends DecoratorNode<React.JSX.Element> {
  __variableName: string
  __nodeId: string
  __formInputs?: FormInputItem[]
  __onFormInputsChange: (inputs: FormInputItem[]) => void
  __onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  __onFormInputItemRemove: (varName: string) => void
  __workflowNodesMap: WorkflowNodesMap
  __getVarType?: GetVarType
  __environmentVariables?: Var[]
  __conversationVariables?: Var[]
  __ragVariables?: Var[]
  __readonly?: boolean

  isIsolated(): boolean {
    return true // This is necessary for drag-and-drop to work correctly
  }

  isTopLevel(): boolean {
    return true // This is necessary for drag-and-drop to work correctly
  }

  static getType(): string {
    return 'hitl-input-block'
  }

  getVariableName(): string {
    const self = this.getLatest()
    return self.__variableName
  }

  getNodeId(): string {
    const self = this.getLatest()
    return self.__nodeId
  }

  getFormInputs(): FormInputItem[] {
    const self = this.getLatest()
    return self.__formInputs || []
  }

  getOnFormInputsChange(): (inputs: FormInputItem[]) => void {
    const self = this.getLatest()
    return self.__onFormInputsChange
  }

  getOnFormInputItemRename(): (payload: FormInputItem, oldName: string) => void {
    const self = this.getLatest()
    return self.__onFormInputItemRename
  }

  getOnFormInputItemRemove(): (varName: string) => void {
    const self = this.getLatest()
    return self.__onFormInputItemRemove
  }

  getWorkflowNodesMap(): WorkflowNodesMap {
    const self = this.getLatest()
    return self.__workflowNodesMap
  }

  getGetVarType(): GetVarType | undefined {
    const self = this.getLatest()
    return self.__getVarType
  }

  getEnvironmentVariables(): Var[] {
    const self = this.getLatest()
    return self.__environmentVariables || []
  }

  getConversationVariables(): Var[] {
    const self = this.getLatest()
    return self.__conversationVariables || []
  }

  getRagVariables(): Var[] {
    const self = this.getLatest()
    return self.__ragVariables || []
  }

  getReadonly(): boolean {
    const self = this.getLatest()
    return self.__readonly || false
  }

  static clone(node: HITLInputNode): HITLInputNode {
    return new HITLInputNode(
      node.__variableName,
      node.__nodeId,
      node.__formInputs || [],
      node.__onFormInputsChange,
      node.__onFormInputItemRename,
      node.__onFormInputItemRemove,
      node.__workflowNodesMap,
      node.__getVarType,
      node.__environmentVariables,
      node.__conversationVariables,
      node.__ragVariables,
      node.__readonly,
      node.__key,
    )
  }

  isInline(): boolean {
    return true
  }

  constructor(
    varName: string,
    nodeId: string,
    formInputs: FormInputItem[],
    onFormInputsChange: (inputs: FormInputItem[]) => void,
    onFormInputItemRename: (payload: FormInputItem, oldName: string) => void,
    onFormInputItemRemove: (varName: string) => void,
    workflowNodesMap: WorkflowNodesMap,
    getVarType?: GetVarType,
    environmentVariables?: Var[],
    conversationVariables?: Var[],
    ragVariables?: Var[],
    readonly?: boolean,
    key?: NodeKey,
  ) {
    super(key)

    this.__variableName = varName
    this.__nodeId = nodeId
    this.__formInputs = formInputs
    this.__onFormInputsChange = onFormInputsChange
    this.__onFormInputItemRename = onFormInputItemRename
    this.__onFormInputItemRemove = onFormInputItemRemove
    this.__workflowNodesMap = workflowNodesMap
    this.__getVarType = getVarType
    this.__environmentVariables = environmentVariables
    this.__conversationVariables = conversationVariables
    this.__ragVariables = ragVariables
    this.__readonly = readonly
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'w-[calc(100%-1px)]', 'items-center', 'align-middle', 'support-drag')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <HILTInputBlockComponent
        nodeKey={this.getKey()}
        varName={this.getVariableName()}
        nodeId={this.getNodeId()}
        formInputs={this.getFormInputs()}
        onChange={this.getOnFormInputsChange()}
        onRename={this.getOnFormInputItemRename()}
        onRemove={this.getOnFormInputItemRemove()}
        workflowNodesMap={this.getWorkflowNodesMap()}
        getVarType={this.getGetVarType()}
        environmentVariables={this.getEnvironmentVariables()}
        conversationVariables={this.getConversationVariables()}
        ragVariables={this.getRagVariables()}
        readonly={this.getReadonly()}
      />
    )
  }

  static importJSON(serializedNode: SerializedNode): HITLInputNode {
    const node = $createHITLInputNode(
      serializedNode.variableName,
      serializedNode.nodeId,
      serializedNode.formInputs,
      serializedNode.onFormInputsChange,
      serializedNode.onFormInputItemRename,
      serializedNode.onFormInputItemRemove,
      serializedNode.workflowNodesMap,
      serializedNode.getVarType,
      serializedNode.environmentVariables,
      serializedNode.conversationVariables,
      serializedNode.ragVariables,
      serializedNode.readonly,
    )

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'hitl-input-block',
      version: 1,
      variableName: this.getVariableName(),
      nodeId: this.getNodeId(),
      formInputs: this.getFormInputs(),
      onFormInputsChange: this.getOnFormInputsChange(),
      onFormInputItemRename: this.getOnFormInputItemRename(),
      onFormInputItemRemove: this.getOnFormInputItemRemove(),
      workflowNodesMap: this.getWorkflowNodesMap(),
      getVarType: this.getGetVarType(),
      environmentVariables: this.getEnvironmentVariables(),
      conversationVariables: this.getConversationVariables(),
      ragVariables: this.getRagVariables(),
      readonly: this.getReadonly(),
    }
  }

  getTextContent(): string {
    return `{{#$output.${this.getVariableName()}#}}`
  }
}

export function $createHITLInputNode(
  variableName: string,
  nodeId: string,
  formInputs: FormInputItem[],
  onFormInputsChange: (inputs: FormInputItem[]) => void,
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void,
  onFormInputItemRemove: (varName: string) => void,
  workflowNodesMap: WorkflowNodesMap,
  getVarType?: GetVarType,
  environmentVariables?: Var[],
  conversationVariables?: Var[],
  ragVariables?: Var[],
  readonly?: boolean,
): HITLInputNode {
  return new HITLInputNode(
    variableName,
    nodeId,
    formInputs,
    onFormInputsChange,
    onFormInputItemRename,
    onFormInputItemRemove,
    workflowNodesMap,
    getVarType,
    environmentVariables,
    conversationVariables,
    ragVariables,
    readonly,
  )
}

export function $isHITLInputNode(
  node: HITLInputNode | LexicalNode | null | undefined,
): node is HITLInputNode {
  return node instanceof HITLInputNode
}
