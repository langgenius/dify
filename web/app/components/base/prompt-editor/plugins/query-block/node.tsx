import type { LexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import QueryBlockComponent from './component'

export class QueryBlockNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'query-block'
  }

  static clone(): QueryBlockNode {
    return new QueryBlockNode()
  }

  isIsolated(): boolean {
    return true
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'items-center')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): JSX.Element {
    return <QueryBlockComponent nodeKey={this.getKey()} />
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
