import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import LastRunBlockComponent from './component'

type SerializedNode = SerializedLexicalNode

export class LastRunBlockNode extends DecoratorNode<React.JSX.Element> {
  static override getType(): string {
    return 'last-run-block'
  }

  static override clone(node: LastRunBlockNode): LastRunBlockNode {
    return new LastRunBlockNode(node.getKey())
  }

  override isInline(): boolean {
    return true
  }

  constructor(key?: NodeKey) {
    super(key)
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
      <LastRunBlockComponent
        nodeKey={this.getKey()}
      />
    )
  }

  static override importJSON(): LastRunBlockNode {
    const node = $createLastRunBlockNode()

    return node
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'last-run-block',
      version: 1,
    }
  }

  override getTextContent(): string {
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
