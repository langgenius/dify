import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import LastRunBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode

export class LastRunBlockNode extends DecoratorNode<React.JSX.Element> {
  static getType(): string {
    return 'last-run-block'
  }

  static clone(node: LastRunBlockNode): LastRunBlockNode {
    return new LastRunBlockNode(node.getKey())
  }

  isInline(): boolean {
    return true
  }

  constructor(key?: NodeKey) {
    super(key)
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
      <LastRunBlockComponent
        nodeKey={this.getKey()}
      />
    )
  }

  static importJSON(): LastRunBlockNode {
    const node = $createLastRunBlockNode()

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'last-run-block',
      version: 1,
    }
  }

  getTextContent(): string {
    return '{{#last_run#}}'
  }
}
export function $createLastRunBlockNode(): LastRunBlockNode {
  return new LastRunBlockNode()
}

export function $isLastRunBlockNode(
  node: LastRunBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof LastRunBlockNode
}
