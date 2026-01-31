import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { RoleName } from './index'
import { DecoratorNode } from 'lexical'
import HistoryBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode & { roleName: RoleName, onEditRole: () => void }

export class HistoryBlockNode extends DecoratorNode<React.JSX.Element> {
  __roleName: RoleName
  __onEditRole: () => void

  static getType(): string {
    return 'history-block'
  }

  static clone(node: HistoryBlockNode): HistoryBlockNode {
    return new HistoryBlockNode(node.__roleName, node.__onEditRole, node.__key)
  }

  constructor(roleName: RoleName, onEditRole: () => void, key?: NodeKey) {
    super(key)

    this.__roleName = roleName
    this.__onEditRole = onEditRole
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
    return (
      <HistoryBlockComponent
        nodeKey={this.getKey()}
        roleName={this.getRoleName()}
        onEditRole={this.getOnEditRole()}
      />
    )
  }

  getRoleName(): RoleName {
    const self = this.getLatest()

    return self.__roleName
  }

  getOnEditRole(): () => void {
    const self = this.getLatest()

    return self.__onEditRole
  }

  static importJSON(serializedNode: SerializedNode): HistoryBlockNode {
    const node = $createHistoryBlockNode(serializedNode.roleName, serializedNode.onEditRole)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'history-block',
      version: 1,
      roleName: this.getRoleName(),
      onEditRole: this.getOnEditRole,
    }
  }

  getTextContent(): string {
    return '{{#histories#}}'
  }
}
export function $createHistoryBlockNode(roleName: RoleName, onEditRole: () => void): HistoryBlockNode {
  return new HistoryBlockNode(roleName, onEditRole)
}

export function $isHistoryBlockNode(
  node: HistoryBlockNode | LexicalNode | null | undefined,
): node is HistoryBlockNode {
  return node instanceof HistoryBlockNode
}
