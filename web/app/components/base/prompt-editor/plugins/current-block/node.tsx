import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import CurrentBlockComponent from './component'
import type { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'

export type SerializedNode = SerializedLexicalNode & { generatorType: GeneratorType; }

export class CurrentBlockNode extends DecoratorNode<React.JSX.Element> {
  __generatorType: GeneratorType
  static getType(): string {
    return 'current-block'
  }

  static clone(node: CurrentBlockNode): CurrentBlockNode {
    return new CurrentBlockNode(node.__generatorType, node.getKey())
  }

  isInline(): boolean {
    return true
  }

  constructor(generatorType: GeneratorType, key?: NodeKey) {
    super(key)

    this.__generatorType = generatorType
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
      <CurrentBlockComponent
        nodeKey={this.getKey()}
        generatorType={this.getGeneratorType()}
      />
    )
  }

  getGeneratorType(): GeneratorType {
    const self = this.getLatest()
    return self.__generatorType
  }

  static importJSON(serializedNode: SerializedNode): CurrentBlockNode {
    const node = $createCurrentBlockNode(serializedNode.generatorType)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'current-block',
      version: 1,
      generatorType: this.getGeneratorType(),
    }
  }

  getTextContent(): string {
    return '{{#current#}}'
  }
}
export function $createCurrentBlockNode(type: GeneratorType): CurrentBlockNode {
  return new CurrentBlockNode(type)
}

export function $isCurrentBlockNode(
  node: CurrentBlockNode | LexicalNode | null | undefined,
): boolean {
  return node instanceof CurrentBlockNode
}
