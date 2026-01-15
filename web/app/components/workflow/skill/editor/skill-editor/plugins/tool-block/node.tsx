import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { Emoji } from '@/app/components/tools/types'
import { DecoratorNode } from 'lexical'
import ToolBlockComponent from './component'
import { buildToolToken } from './utils'

export type ToolBlockPayload = {
  provider: string
  tool: string
  configId: string
  label?: string
  icon?: string | Emoji
  iconDark?: string | Emoji
}

export type SerializedToolBlockNode = SerializedLexicalNode & ToolBlockPayload

export class ToolBlockNode extends DecoratorNode<React.JSX.Element> {
  __provider: string
  __tool: string
  __configId: string
  __label?: string
  __icon?: string | Emoji
  __iconDark?: string | Emoji

  static getType(): string {
    return 'tool-block'
  }

  static clone(node: ToolBlockNode): ToolBlockNode {
    return new ToolBlockNode(
      {
        provider: node.__provider,
        tool: node.__tool,
        configId: node.__configId,
        label: node.__label,
        icon: node.__icon,
        iconDark: node.__iconDark,
      },
      node.__key,
    )
  }

  isInline(): boolean {
    return true
  }

  constructor(payload: ToolBlockPayload, key?: NodeKey) {
    super(key)
    this.__provider = payload.provider
    this.__tool = payload.tool
    this.__configId = payload.configId
    this.__label = payload.label
    this.__icon = payload.icon
    this.__iconDark = payload.iconDark
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span')
    span.classList.add('inline-flex', 'items-center', 'align-middle')
    return span
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <ToolBlockComponent
        nodeKey={this.getKey()}
        provider={this.__provider}
        tool={this.__tool}
        label={this.__label}
        icon={this.__icon}
        iconDark={this.__iconDark}
      />
    )
  }

  exportJSON(): SerializedToolBlockNode {
    return {
      type: 'tool-block',
      version: 1,
      provider: this.__provider,
      tool: this.__tool,
      configId: this.__configId,
      label: this.__label,
      icon: this.__icon,
      iconDark: this.__iconDark,
    }
  }

  static importJSON(serializedNode: SerializedToolBlockNode): ToolBlockNode {
    return $createToolBlockNode(serializedNode)
  }

  getTextContent(): string {
    return buildToolToken({
      provider: this.__provider,
      tool: this.__tool,
      configId: this.__configId,
    })
  }
}

export function $createToolBlockNode(payload: ToolBlockPayload): ToolBlockNode {
  return new ToolBlockNode(payload)
}

export function $isToolBlockNode(
  node: ToolBlockNode | LexicalNode | null | undefined,
): node is ToolBlockNode {
  return node instanceof ToolBlockNode
}
