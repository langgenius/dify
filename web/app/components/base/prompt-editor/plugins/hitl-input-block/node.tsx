import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import HILTInputBlockComponent from './component'

export type SerializedNode = SerializedLexicalNode & {
  variableName: string
}

export class HITLInputNode extends DecoratorNode<React.JSX.Element> {
  __variableName: string

  static getType(): string {
    return 'hitl-input-block'
  }

  getVariableName(): string {
    const self = this.getLatest()
    return self.__variableName
  }

  static clone(node: HITLInputNode): HITLInputNode {
    return new HITLInputNode(node.__variableName, node.__key)
  }

  isInline(): boolean {
    return true
  }

  constructor(varName: string, key?: NodeKey) {
    super(key)

    this.__variableName = varName
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.classList.add('flex', 'w-full', 'items-center', 'align-middle')
    return div
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return <HILTInputBlockComponent nodeKey={this.getKey()} nodeName='todo' varName={this.getVariableName()} />
  }

  static importJSON(serializedNode: SerializedNode): HITLInputNode {
    const node = $createHITLInputNode(serializedNode.variableName)

    return node
  }

  exportJSON(): SerializedNode {
    return {
      type: 'hitl-input-block',
      version: 1,
      variableName: this.getVariableName(),
    }
  }

  getTextContent(): string {
    return `{{#$output.${this.getVariableName()}#}}`
  }
}

export function $createHITLInputNode(variableName: string): HITLInputNode {
  return new HITLInputNode(variableName)
}

export function $isHITLInputNode(
  node: HITLInputNode | LexicalNode | null | undefined,
): node is HITLInputNode {
  return node instanceof HITLInputNode
}
