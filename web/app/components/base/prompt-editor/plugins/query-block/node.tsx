import type { LexicalNode, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import QueryBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode

export class QueryBlockNode extends DecoratorNode<React.JSX.Element> {
  static getType(): string {
    return 'query-block'
  }

  static clone(): QueryBlockNode {
    return new QueryBlockNode()
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
    return <QueryBlockComponent nodeKey={this.getKey()} />
  }

  static importJSON(): QueryBlockNode {
    const node = $createQueryBlockNode()

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'query-block',
      version: 1,
    }
  }

  getTextContent(): string {
    return '{{#query#}}'
  }
}
export function $createQueryBlockNode(): QueryBlockNode {
  return new QueryBlockNode()
}

export function $isQueryBlockNode(
  node: QueryBlockNode | LexicalNode | null | undefined,
): node is QueryBlockNode {
  return node instanceof QueryBlockNode
}
