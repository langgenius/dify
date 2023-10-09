import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import HistoryBlockComponent from './component'
import type { RoleName } from './index'

export type SerializedNode = SerializedLexicalNode & { roleName: RoleName }

export class HistoryBlockNode extends DecoratorNode<JSX.Element> {
  __roleName: RoleName

  static getType(): string {
    return 'history-block'
  }

  static clone(node: HistoryBlockNode): HistoryBlockNode {
    return new HistoryBlockNode(node.__roleName)
  }

  constructor(roleName: RoleName, key?: NodeKey) {
    super(key)

    this.__roleName = roleName
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

  decorate(): JSX.Element {
    return <HistoryBlockComponent nodeKey={this.getKey()} roleName={this.getRoleName()} />
  }

  getRoleName(): RoleName {
    const self = this.getLatest()

    return self.__roleName
  }

  static importJSON(serializedNode: SerializedNode): HistoryBlockNode {
    const node = $createHistoryBlockNode(serializedNode.roleName)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'history-block',
      version: 1,
      roleName: this.getRoleName(),
    }
  }

  getTextContent(): string {
    return '{{#histories#}}'
  }
}
export function $createHistoryBlockNode(roleName: RoleName): HistoryBlockNode {
  return new HistoryBlockNode(roleName)
}

export function $isHistoryBlockNode(
  node: HistoryBlockNode | LexicalNode | null | undefined,
): node is HistoryBlockNode {
  return node instanceof HistoryBlockNode
}
