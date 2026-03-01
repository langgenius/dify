import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import ErrorMessageBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode

export class ErrorMessageBlockNode extends DecoratorNode<React.JSX.Element> {
  static getType(): string {
    return 'error-message-block'
  }

  static clone(node: ErrorMessageBlockNode): ErrorMessageBlockNode {
    return new ErrorMessageBlockNode(node.getKey())
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
      <ErrorMessageBlockComponent
        nodeKey={this.getKey()}
      />
    )
  }

  static importJSON(): ErrorMessageBlockNode {
    const node = $createErrorMessageBlockNode()

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'error-message-block',
      version: 1,
    }
  }

  getTextContent(): string {
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
