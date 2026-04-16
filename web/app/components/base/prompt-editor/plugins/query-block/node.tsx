import type { LexicalNode, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import QueryBlockComponent from './component'

type SerializedNode = SerializedLexicalNode

export class QueryBlockNode extends DecoratorNode<React.JSX.Element> {
  static override getType(): string {
    return 'query-block'
  }

  static override clone(): QueryBlockNode {
    return new QueryBlockNode()
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
    return <QueryBlockComponent nodeKey={this.getKey()} />
  }

  static override importJSON(): QueryBlockNode {
    const node = $createQueryBlockNode()

    return node
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'query-block',
      version: 1,
    }
  }

  override getTextContent(): string {
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
