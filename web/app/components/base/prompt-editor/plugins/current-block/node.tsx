import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import type { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { DecoratorNode } from 'lexical'
import CurrentBlockComponent from './component'

type SerializedNode = SerializedLexicalNode & { generatorType: GeneratorType }

export class CurrentBlockNode extends DecoratorNode<React.JSX.Element> {
  __generatorType: GeneratorType
  static override getType(): string {
    return 'current-block'
  }

  static override clone(node: CurrentBlockNode): CurrentBlockNode {
    return new CurrentBlockNode(node.__generatorType, node.getKey())
  }

  override isInline(): boolean {
    return true
  }

  constructor(generatorType: GeneratorType, key?: NodeKey) {
    super(key)

    this.__generatorType = generatorType
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

  static override importJSON(serializedNode: SerializedNode): CurrentBlockNode {
    const node = $createCurrentBlockNode(serializedNode.generatorType)

    return node
  }

  override exportJSON(): SerializedNode {
    return {
      type: 'current-block',
      version: 1,
      generatorType: this.getGeneratorType(),
    }
  }

  override getTextContent(): string {
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
