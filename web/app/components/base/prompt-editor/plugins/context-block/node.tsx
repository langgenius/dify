import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import ContextBlockComponent from './component'
import type { Dataset } from './index'

export type SerializedNode = SerializedLexicalNode & { datasets: Dataset[] }

export class ContextBlockNode extends DecoratorNode<JSX.Element> {
  __datasets: Dataset[]

  static getType(): string {
    return 'context-block'
  }

  static clone(node: ContextBlockNode): ContextBlockNode {
    return new ContextBlockNode(node.__datasets)
  }

  isInline(): boolean {
    return true
  }

  constructor(datasets: Dataset[], key?: NodeKey) {
    super(key)

    this.__datasets = datasets
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
    return <ContextBlockComponent nodeKey={this.getKey()} datasets={this.getDatasets()} />
  }

  getDatasets(): Dataset[] {
    const self = this.getLatest()

    return self.__datasets
  }

  static importJSON(serializedNode: SerializedNode): ContextBlockNode {
    const node = $createContextBlockNode(serializedNode.datasets)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'context-block',
      version: 1,
      datasets: this.getDatasets(),
    }
  }

  getTextContent(): string {
    return '{{#context#}}'
  }
}
export function $createContextBlockNode(datasets: Dataset[]): ContextBlockNode {
  return new ContextBlockNode(datasets)
}

export function $isContextBlockNode(
  node: ContextBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof ContextBlockNode
}
