import type { LexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import ContextBlockComponent from './component'

export class ContextBlockNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'context-block'
  }

  static clone(): ContextBlockNode {
    return new ContextBlockNode()
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
    return <ContextBlockComponent nodeKey={this.getKey()} />
  }
}
export function $createContextBlockNode(): ContextBlockNode {
  return new ContextBlockNode()
}

export function $isContextBlockNode(
  node: ContextBlockNode | LexicalNode | null | undefined,
): node is ContextBlockNode {
  return node instanceof ContextBlockNode
}
