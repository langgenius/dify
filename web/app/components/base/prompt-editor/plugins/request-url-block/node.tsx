import type { LexicalNode, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import RequestURLBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode

export class RequestURLBlockNode extends DecoratorNode<React.JSX.Element> {
  static getType(): string {
    return 'request-url-block'
  }

  static clone(node: RequestURLBlockNode): RequestURLBlockNode {
    return new RequestURLBlockNode(node.__key)
  }

  isInline(): boolean {
    return true
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
    return <RequestURLBlockComponent nodeKey={this.getKey()} />
  }

  static importJSON(): RequestURLBlockNode {
    const node = $createRequestURLBlockNode()

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'request-url-block',
      version: 1,
    }
  }

  getTextContent(): string {
    return '{{#url#}}'
  }
}
export function $createRequestURLBlockNode(): RequestURLBlockNode {
  return new RequestURLBlockNode()
}

export function $isRequestURLBlockNode(
  node: RequestURLBlockNode | LexicalNode | null | undefined,
): node is RequestURLBlockNode {
  return node instanceof RequestURLBlockNode
}
