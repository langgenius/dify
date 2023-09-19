import type { EditorConfig, NodeKey } from 'lexical'
import { TextNode } from 'lexical'

export class CustomTextNode extends TextNode {
  static getType() {
    return 'custom-text'
  }

  static clone(node: CustomTextNode) {
    return new CustomTextNode(node.__text, node.__key)
  }

  constructor(text: string, key?: NodeKey) {
    super(text, key)
  }

  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config)
    dom.classList.add('align-middle')
    return dom
  }

  isSimpleText() {
    return (
      (this.__type === 'text' || this.__type === 'custom-text') && this.__mode === 0)
  }
}
