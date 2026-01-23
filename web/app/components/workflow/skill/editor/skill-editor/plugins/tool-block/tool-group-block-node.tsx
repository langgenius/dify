import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { ToolToken } from './utils'
import { DecoratorNode } from 'lexical'
import ToolGroupBlockComponent from './tool-group-block-component'
import { buildToolTokenList } from './utils'

export type ToolGroupBlockPayload = {
  tools: ToolToken[]
}

export type SerializedToolGroupBlockNode = SerializedLexicalNode & ToolGroupBlockPayload

export class ToolGroupBlockNode extends DecoratorNode<React.JSX.Element> {
  __tools: ToolToken[]

  static getType(): string {
    return 'tool-group-block'
  }

  static clone(node: ToolGroupBlockNode): ToolGroupBlockNode {
    return new ToolGroupBlockNode(
      {
        tools: node.__tools,
      },
      node.__key,
    )
  }

  isInline(): boolean {
    return true
  }

  constructor(payload: ToolGroupBlockPayload, key?: NodeKey) {
    super(key)
    this.__tools = payload.tools
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
      <ToolGroupBlockComponent
        nodeKey={this.getKey()}
        tools={this.__tools}
      />
    )
  }

  exportJSON(): SerializedToolGroupBlockNode {
    return {
      type: 'tool-group-block',
      version: 1,
      tools: this.__tools,
    }
  }

  static importJSON(serializedNode: SerializedToolGroupBlockNode): ToolGroupBlockNode {
    return $createToolGroupBlockNode(serializedNode)
  }

  getTextContent(): string {
    return buildToolTokenList(this.__tools)
  }
}

export function $createToolGroupBlockNode(payload: ToolGroupBlockPayload): ToolGroupBlockNode {
  return new ToolGroupBlockNode(payload)
}

export function $isToolGroupBlockNode(
  node: ToolGroupBlockNode | LexicalNode | null | undefined,
): node is ToolGroupBlockNode {
  return node instanceof ToolGroupBlockNode
}
