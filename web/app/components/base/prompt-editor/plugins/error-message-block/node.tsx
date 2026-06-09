import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import ErrorMessageBlockComponent from './component'

type SerializedNode = SerializedLexicalNode

export class ErrorMessageBlockNode extends DecoratorNode<React.JSX.Element> {
  static override getType(): string {
    return 'error-message-block'
  }

  static override clone(node: ErrorMessageBlockNode): ErrorMessageBlockNode {
    return new ErrorMessageBlockNode(node.getKey())
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
      <ErrorMessageBlockComponent
        nodeKey={this.getKey()}
      />
    )
  }

  static override importJSON(): ErrorMessageBlockNode {
    const node = $createErrorMessageBlockNode()

    return node
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'error-message-block',
      version: 1,
    }
  }

  override getTextContent(): string {
    return '{{#error_message#}}'
  }
}
export function $createErrorMessageBlockNode(): ErrorMessageBlockNode {
  return new ErrorMessageBlockNode()
}

export function $isErrorMessageBlockNode(
  node: ErrorMessageBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof ErrorMessageBlockNode
}
