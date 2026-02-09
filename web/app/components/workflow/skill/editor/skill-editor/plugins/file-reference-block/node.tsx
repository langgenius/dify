import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import FileReferenceBlock from './component'
import { buildFileReferenceToken } from './utils'

export type FileReferencePayload = {
  resourceId: string
}

export type SerializedFileReferenceNode = SerializedLexicalNode & FileReferencePayload

export class FileReferenceNode extends DecoratorNode<React.JSX.Element> {
  __resourceId: string

  static getType(): string {
    return 'file-reference-block'
  }

  static clone(node: FileReferenceNode): FileReferenceNode {
    return new FileReferenceNode({ resourceId: node.__resourceId }, node.__key)
  }

  isInline(): boolean {
    return true
  }

  constructor(payload: FileReferencePayload, key?: NodeKey) {
    super(key)
    this.__resourceId = payload.resourceId
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span')
    span.classList.add('inline-flex', 'items-center', 'align-middle')
    return span
  }

  updateDOM(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <FileReferenceBlock
        nodeKey={this.getKey()}
        resourceId={this.__resourceId}
      />
    )
  }

  setResourceId(resourceId: string): void {
    const writable = this.getWritable()
    writable.__resourceId = resourceId
  }

  exportJSON(): SerializedFileReferenceNode {
    return {
      type: 'file-reference-block',
      version: 1,
      resourceId: this.__resourceId,
    }
  }

  static importJSON(serializedNode: SerializedFileReferenceNode): FileReferenceNode {
    return $createFileReferenceNode(serializedNode)
  }

  getTextContent(): string {
    return buildFileReferenceToken(this.__resourceId)
  }
}

export function $createFileReferenceNode(payload: FileReferencePayload): FileReferenceNode {
  return new FileReferenceNode(payload)
}

export function $isFileReferenceNode(
  node: FileReferenceNode | LexicalNode | null | undefined,
): node is FileReferenceNode {
  return node instanceof FileReferenceNode
}
