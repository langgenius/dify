import type { EditorConfig, SerializedTextNode } from 'lexical'
import { $createTextNode, TextNode } from 'lexical'

export class CustomTextNode extends TextNode {
  static override getType() {
    return 'custom-text'
  }

  static override clone(node: CustomTextNode) {
    return new CustomTextNode(node.__text, node.__key)
  }

  // constructor(text: string, key?: NodeKey) {
  //   super(text, key)
  // }

  override createDOM(config: EditorConfig) {
    const dom = super.createDOM(config)
    return dom
  }

  static override importJSON(serializedNode: SerializedTextNode): TextNode {
    const node = $createTextNode(serializedNode.text)
    node.setFormat(serializedNode.format)
    node.setDetail(serializedNode.detail)
    node.setMode(serializedNode.mode)
    node.setStyle(serializedNode.style)
    return node
  }

  override exportJSON(): SerializedTextNode {
    return {
      detail: this.getDetail(),
      format: this.getFormat(),
      mode: this.getMode(),
      style: this.getStyle(),
      text: this.getTextContent(),
      type: 'custom-text',
      version: 1,
    }
  }

  override isSimpleText() {
    return (
      (this.__type === 'text' || this.__type === 'custom-text') && this.__mode === 0)
  }
}

export function $createCustomTextNode(text: string): CustomTextNode {
  return new CustomTextNode(text)
}
