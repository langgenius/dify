import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { Dataset } from './index'
import { DecoratorNode } from 'lexical'
import ContextBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode & { datasets: Dataset[], onAddContext: () => void, canNotAddContext: boolean }

export class ContextBlockNode extends DecoratorNode<React.JSX.Element> {
  __datasets: Dataset[]
  __onAddContext: () => void
  __canNotAddContext: boolean

  static getType(): string {
    return 'context-block'
  }

  static clone(node: ContextBlockNode): ContextBlockNode {
    return new ContextBlockNode(node.__datasets, node.__onAddContext, node.getKey(), node.__canNotAddContext)
  }

  isInline(): boolean {
    return true
  }

  constructor(datasets: Dataset[], onAddContext: () => void, key?: NodeKey, canNotAddContext?: boolean) {
    super(key)

    this.__datasets = datasets
    this.__onAddContext = onAddContext
    this.__canNotAddContext = canNotAddContext || false
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
      <ContextBlockComponent
        nodeKey={this.getKey()}
        datasets={this.getDatasets()}
        onAddContext={this.getOnAddContext()}
        canNotAddContext={this.getCanNotAddContext()}
      />
    )
  }

  getDatasets(): Dataset[] {
    const self = this.getLatest()

    return self.__datasets
  }

  getOnAddContext(): () => void {
    const self = this.getLatest()

    return self.__onAddContext
  }

  getCanNotAddContext(): boolean {
    const self = this.getLatest()

    return self.__canNotAddContext
  }

  static importJSON(serializedNode: SerializedNode): ContextBlockNode {
    const node = $createContextBlockNode(serializedNode.datasets, serializedNode.onAddContext, serializedNode.canNotAddContext)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'context-block',
      version: 1,
      datasets: this.getDatasets(),
      onAddContext: this.getOnAddContext(),
      canNotAddContext: this.getCanNotAddContext(),
    }
  }

  getTextContent(): string {
    return '{{#context#}}'
  }
}
export function $createContextBlockNode(datasets: Dataset[], onAddContext: () => void, canNotAddContext?: boolean): ContextBlockNode {
  return new ContextBlockNode(datasets, onAddContext, undefined, canNotAddContext)
}

export function $isContextBlockNode(
  node: ContextBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof ContextBlockNode
}
