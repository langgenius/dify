import type { LexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import HistoryBlockComponent from './component'

export class HistoryBlockNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'context-block'
  }

  static clone(): HistoryBlockNode {
    return new HistoryBlockNode()
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
    return <HistoryBlockComponent />
  }
}
export function $createHistoryBlockNode(): HistoryBlockNode {
  return new HistoryBlockNode()
}

export function $isHistoryBlockNode(
  node: HistoryBlockNode | LexicalNode | null | undefined,
): node is HistoryBlockNode {
  return node instanceof HistoryBlockNode
}
