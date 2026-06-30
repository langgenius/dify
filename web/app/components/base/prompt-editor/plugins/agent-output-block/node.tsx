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
  __outputs: DeclaredOutputConfig[]
  __onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void

  static override getType(): string {
    return 'agent-output-block'
  }

  static override clone(node: AgentOutputBlockNode): AgentOutputBlockNode {
    return new AgentOutputBlockNode(
      node.__name,
      node.__outputType,
      node.__isEditing,
      node.__outputs,
      node.__onChange,
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
    outputs: DeclaredOutputConfig[] = [],
    onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void,
    key?: NodeKey,
  ) {
    super(key)

    this.__name = name
    this.__outputType = outputType
    this.__isEditing = isEditing
    this.__outputs = outputs
    this.__onChange = onChange
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
        outputs={this.getOutputs()}
        onChange={this.getOnChange()}
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

  getOutputs(): DeclaredOutputConfig[] {
    return this.getLatest().__outputs
  }

  getOnChange(): ((outputs: DeclaredOutputConfig[], prompt?: string) => void) | undefined {
    return this.getLatest().__onChange
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
): AgentOutputBlockNode {
  return new AgentOutputBlockNode(name, outputType, isEditing, outputs, onChange)
}

export function $isAgentOutputBlockNode(
  node: AgentOutputBlockNode | LexicalNode | null | undefined,
): node is AgentOutputBlockNode {
  return node instanceof AgentOutputBlockNode
}
