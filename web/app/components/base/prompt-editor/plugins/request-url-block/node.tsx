import type { LexicalNode, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import RequestURLBlockComponent from './component'

type SerializedNode = SerializedLexicalNode

export class RequestURLBlockNode extends DecoratorNode<React.JSX.Element> {
  static override getType(): string {
    return 'request-url-block'
  }

  static override clone(node: RequestURLBlockNode): RequestURLBlockNode {
    return new RequestURLBlockNode(node.__key)
  }

  override isInline(): boolean {
    return true
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
    return <RequestURLBlockComponent nodeKey={this.getKey()} />
  }

  static override importJSON(): RequestURLBlockNode {
    const node = $createRequestURLBlockNode()

    return node
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'request-url-block',
      version: 1,
    }
  }

  override getTextContent(): string {
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
