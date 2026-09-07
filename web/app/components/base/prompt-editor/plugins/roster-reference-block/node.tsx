import type { NodeKey, SerializedLexicalNode } from 'lexical'
import type { JSX } from 'react'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import RosterReferenceBlockComponent from './component'

type SerializedRosterReferenceBlockNode = SerializedLexicalNode & {
  text: string
}

export class RosterReferenceBlockNode extends DecoratorNode<JSX.Element> {
  __text: string

  static override getType(): string {
    return 'roster-reference-block'
  }

  static override clone(node: RosterReferenceBlockNode): RosterReferenceBlockNode {
    return new RosterReferenceBlockNode(node.__text, node.__key)
  }

  constructor(text: string, key?: NodeKey) {
    super(key)
    this.__text = text
  }

  override isInline(): boolean {
    return true
  }

  override createDOM(): HTMLElement {
    const span = document.createElement('span')
    span.classList.add('inline-flex', 'items-center', 'align-middle')
    return span
  }

  override updateDOM(): false {
    return false
  }

  override decorate(): JSX.Element {
    return <RosterReferenceBlockComponent text={this.getTextContent()} />
  }

  static override importJSON(
    serializedNode: SerializedRosterReferenceBlockNode,
  ): RosterReferenceBlockNode {
    return $createRosterReferenceBlockNode(serializedNode.text)
  }

  override exportJSON(): SerializedRosterReferenceBlockNode {
    return {
      text: this.getTextContent(),
      type: 'roster-reference-block',
      version: 1,
    }
  }

  override getTextContent(): string {
    return this.getLatest().__text
  }
}

export function $createRosterReferenceBlockNode(text = ''): RosterReferenceBlockNode {
  return $applyNodeReplacement(new RosterReferenceBlockNode(text))
}
