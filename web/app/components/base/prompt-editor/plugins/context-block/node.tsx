import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import { latestDatasets } from '../../index'
import ContextBlockComponent from './component'
import type { Dataset } from './index'

export type SerializedNode = SerializedLexicalNode & { datasets: Dataset[]; onAddContext: () => void }

export class ContextBlockNode extends DecoratorNode<JSX.Element> {
  __datasets: Dataset[]
  __onAddContext: () => void

  static getType(): string {
    return 'context-block'
  }

  static clone(node: ContextBlockNode): ContextBlockNode {
    return new ContextBlockNode(node.__datasets, node.__onAddContext)
  }

  setFormat() {}

  isInline(): boolean {
    return true
  }

  constructor(datasets: Dataset[], onAddContext: () => void, key?: NodeKey) {
    super(key)

    this.__datasets = datasets
    this.__onAddContext = onAddContext
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('inline-flex', 'items-center', 'align-middle')
    return div
  }

  updateDOM(): false {
    if (latestDatasets !== this.getDatasets())
      this.setDatasets(latestDatasets)

    return false
  }

  decorate(): JSX.Element {
    return (
      <ContextBlockComponent
        nodeKey={this.getKey()}
        datasets={this.getDatasets()}
        onAddContext={this.getOnAddContext()}
      />
    )
  }

  getDatasets(): Dataset[] {
    const self = this.getLatest()

    return self.__datasets
  }

  setDatasets(datasets: Dataset[]): void {
    const self = this.getWritable()

    self.__datasets = datasets
  }

  getOnAddContext(): () => void {
    const self = this.getLatest()

    return self.__onAddContext
  }

  static importJSON(serializedNode: SerializedNode): ContextBlockNode {
    const node = $createContextBlockNode(serializedNode.datasets, serializedNode.onAddContext)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'context-block',
      version: 1,
      datasets: this.getDatasets(),
      onAddContext: this.getOnAddContext(),
    }
  }

  getTextContent(): string {
    return '{{#context#}}'
  }
}
export function $createContextBlockNode(datasets: Dataset[], onAddContext: () => void): ContextBlockNode {
  return new ContextBlockNode(datasets, onAddContext)
}

export function $isContextBlockNode(
  node: ContextBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof ContextBlockNode
}
