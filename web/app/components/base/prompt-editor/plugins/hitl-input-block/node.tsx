import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import HILTInputBlockComponent from './component'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'

export type HITLNodeProps = {
  variableName: string
  nodeId: string
  nodeTitle: string
  formInputs: FormInputItem[]
  onFormInputsChange: (inputs: FormInputItem[]) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onFormInputItemRemove: (varName: string) => void
}

export type SerializedNode = SerializedLexicalNode & HITLNodeProps

export class HITLInputNode extends DecoratorNode<React.JSX.Element> {
  __variableName: string
  __nodeId: string
  __nodeTitle: string
  __formInputs?: FormInputItem[]
  __onFormInputsChange: (inputs: FormInputItem[]) => void
  __onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  __onFormInputItemRemove: (varName: string) => void

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

  getNodeTitle(): string {
    const self = this.getLatest()
    return self.__nodeTitle
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

  static clone(node: HITLInputNode): HITLInputNode {
    return new HITLInputNode(
      node.__variableName,
      node.__nodeId,
      node.__nodeTitle,
      node.__formInputs || [],
      node.__onFormInputsChange,
      node.__onFormInputItemRename,
      node.__onFormInputItemRemove,
      node.__key,
    )
  }

  isInline(): boolean {
    return true
  }

  constructor(
    varName: string,
    nodeId: string,
    nodeTitle: string,
    formInputs: FormInputItem[],
    onFormInputsChange: (inputs: FormInputItem[]) => void,
    onFormInputItemRename: (payload: FormInputItem, oldName: string) => void,
    onFormInputItemRemove: (varName: string) => void,
    key?: NodeKey,
  ) {
    super(key)

    this.__variableName = varName
    this.__nodeId = nodeId
    this.__nodeTitle = nodeTitle
    this.__formInputs = formInputs
    this.__onFormInputsChange = onFormInputsChange
    this.__onFormInputItemRename = onFormInputItemRename
    this.__onFormInputItemRemove = onFormInputItemRemove
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('flex', 'items-center', 'align-middle', 'support-drag')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return <HILTInputBlockComponent
      nodeKey={this.getKey()}
      varName={this.getVariableName()}
      nodeId={this.getNodeId()}
      nodeTitle={this.getNodeTitle()}
      formInputs={this.getFormInputs()}
      onChange={this.getOnFormInputsChange()}
      onRename={this.getOnFormInputItemRename()}
      onRemove={this.getOnFormInputItemRemove()}
    />
  }

  static importJSON(serializedNode: SerializedNode): HITLInputNode {
    const node = $createHITLInputNode(
      serializedNode.variableName,
      serializedNode.nodeId,
      serializedNode.nodeTitle,
      serializedNode.formInputs,
      serializedNode.onFormInputsChange,
      serializedNode.onFormInputItemRename,
      serializedNode.onFormInputItemRemove,
    )

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'hitl-input-block',
      version: 1,
      variableName: this.getVariableName(),
      nodeId: this.getNodeId(),
      nodeTitle: this.getNodeTitle(),
      formInputs: this.getFormInputs(),
      onFormInputsChange: this.getOnFormInputsChange(),
      onFormInputItemRename: this.getOnFormInputItemRename(),
      onFormInputItemRemove: this.getOnFormInputItemRemove(),
    }
  }

  getTextContent(): string {
    return `{{#$output.${this.getVariableName()}#}}`
  }
}

export function $createHITLInputNode(
  variableName: string,
  nodeId: string,
  nodeTitle: string,
  formInputs: FormInputItem[],
  onFormInputsChange: (inputs: FormInputItem[]) => void,
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void,
  onFormInputItemRemove: (varName: string) => void,
): HITLInputNode {
  return new HITLInputNode(
    variableName,
    nodeId,
    nodeTitle,
    formInputs,
    onFormInputsChange,
    onFormInputItemRename,
    onFormInputItemRemove,
  )
}

export function $isHITLInputNode(
  node: HITLInputNode | LexicalNode | null | undefined,
): node is HITLInputNode {
  return node instanceof HITLInputNode
}
