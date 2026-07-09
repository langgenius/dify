import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { AgentOutputTypeOptionValue } from './utils'
import { DecoratorNode } from 'lexical'
import AgentOutputBlockComponent from './component'
import { getAgentOutputToken } from './utils'

type SerializedNode = SerializedLexicalNode & {
  name: string
  outputType: AgentOutputTypeOptionValue
}

export class AgentOutputBlockNode extends DecoratorNode<React.JSX.Element> {
  __name: string
  __outputType: AgentOutputTypeOptionValue
  __isEditing: boolean
  __selectNameOnEdit: boolean
  __openTypeSelectOnEdit: boolean
  __outputs: DeclaredOutputConfig[]
  __onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void
  __onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void

  static override getType(): string {
    return 'agent-output-block'
  }

  static override clone(node: AgentOutputBlockNode): AgentOutputBlockNode {
    return new AgentOutputBlockNode(
      node.__name,
      node.__outputType,
      node.__isEditing,
      node.__selectNameOnEdit,
      node.__openTypeSelectOnEdit,
      node.__outputs,
      node.__onChange,
      node.__onEdit,
      node.__key,
    )
  }

  override isInline(): boolean {
    return true
  }

  constructor(
    name: string,
    outputType: AgentOutputTypeOptionValue,
    isEditing = false,
    selectNameOnEdit = isEditing,
    openTypeSelectOnEdit = false,
    outputs: DeclaredOutputConfig[] = [],
    onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void,
    onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void,
    key?: NodeKey,
  ) {
    super(key)

    this.__name = name
    this.__outputType = outputType
    this.__isEditing = isEditing
    this.__selectNameOnEdit = selectNameOnEdit
    this.__openTypeSelectOnEdit = openTypeSelectOnEdit
    this.__outputs = outputs
    this.__onChange = onChange
    this.__onEdit = onEdit
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
      <AgentOutputBlockComponent
        nodeKey={this.getKey()}
        name={this.getName()}
        outputType={this.getOutputType()}
        isEditing={this.isEditing()}
        selectNameOnEdit={this.shouldSelectNameOnEdit()}
        openTypeSelectOnEdit={this.shouldOpenTypeSelectOnEdit()}
        outputs={this.getOutputs()}
        onChange={this.getOnChange()}
        onEdit={this.getOnEdit()}
      />
    )
  }

  static override importJSON(serializedNode: SerializedNode): AgentOutputBlockNode {
    return $createAgentOutputBlockNode(serializedNode.name, serializedNode.outputType)
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'agent-output-block',
      version: 1,
      name: this.getName(),
      outputType: this.getOutputType(),
    }
  }

  getName(): string {
    return this.getLatest().__name
  }

  getOutputType(): AgentOutputTypeOptionValue {
    return this.getLatest().__outputType
  }

  isEditing(): boolean {
    return this.getLatest().__isEditing
  }

  shouldSelectNameOnEdit(): boolean {
    return this.getLatest().__selectNameOnEdit
  }

  shouldOpenTypeSelectOnEdit(): boolean {
    return this.getLatest().__openTypeSelectOnEdit
  }

  getOutputs(): DeclaredOutputConfig[] {
    return this.getLatest().__outputs
  }

  getOnChange(): ((outputs: DeclaredOutputConfig[], prompt?: string) => void) | undefined {
    return this.getLatest().__onChange
  }

  getOnEdit(): ((name: string, outputType: AgentOutputTypeOptionValue) => void) | undefined {
    return this.getLatest().__onEdit
  }

  setOutput(
    name: string,
    outputType: AgentOutputTypeOptionValue,
    isEditing: boolean,
    outputs: DeclaredOutputConfig[],
    onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void,
    onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void,
    selectNameOnEdit = false,
    openTypeSelectOnEdit = false,
  ): this {
    const writable = this.getWritable()
    writable.__name = name
    writable.__outputType = outputType
    writable.__isEditing = isEditing
    writable.__selectNameOnEdit = selectNameOnEdit
    writable.__openTypeSelectOnEdit = openTypeSelectOnEdit
    writable.__outputs = outputs
    writable.__onChange = onChange
    writable.__onEdit = onEdit
    return writable
  }

  setOpenTypeSelectOnEdit(openTypeSelectOnEdit: boolean): this {
    const writable = this.getWritable()
    writable.__openTypeSelectOnEdit = openTypeSelectOnEdit
    return writable
  }

  override getTextContent(): string {
    return getAgentOutputToken(this.getName())
  }
}

export function $createAgentOutputBlockNode(
  name: string,
  outputType: AgentOutputTypeOptionValue = 'string',
  isEditing = false,
  outputs: DeclaredOutputConfig[] = [],
  onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void,
  onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void,
  selectNameOnEdit = isEditing,
  openTypeSelectOnEdit = false,
): AgentOutputBlockNode {
  return new AgentOutputBlockNode(name, outputType, isEditing, selectNameOnEdit, openTypeSelectOnEdit, outputs, onChange, onEdit)
}

export function $isAgentOutputBlockNode(
  node: AgentOutputBlockNode | LexicalNode | null | undefined,
): node is AgentOutputBlockNode {
  return node instanceof AgentOutputBlockNode
}
