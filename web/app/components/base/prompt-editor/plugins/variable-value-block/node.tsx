import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
} from 'lexical'
import {
  $applyNodeReplacement,
  TextNode,
} from 'lexical'

export class VariableValueBlockNode extends TextNode {
  static getType(): string {
    return 'variable-value-block'
  }

  static clone(node: VariableValueBlockNode): VariableValueBlockNode {
    return new VariableValueBlockNode(node.__text, node.__key)
  }

  constructor(text: string, key?: NodeKey) {
    super(text, key)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.classList.add('inline-flex', 'items-center', 'px-0.5', 'h-[22px]', 'bg-[#EFF4FF]', 'text-[#155EEF]', 'rounded-[5px]')
    return element
  }

  exportJSON(): SerializedTextNode {
    return {
      ...super.exportJSON(),
      type: 'variable-value',
    }
  }

  canInsertTextBefore(): boolean {
    return false
  }

  isTextEntity(): true {
    return true
  }
}

export function $createVariableValueBlockNode(text = ''): VariableValueBlockNode {
  return $applyNodeReplacement(new VariableValueBlockNode(text))
}

export function $isVariableValueNodeBlock(
  node: LexicalNode | null | undefined,
): node is VariableValueBlockNode {
  return node instanceof VariableValueBlockNode
}
