import type {
  LexicalNode,
  NodeKey,
} from 'lexical'
import { $applyNodeReplacement, TextNode } from 'lexical'

export class VariableValueNode extends TextNode {
  static getType(): string {
    return 'variable-value'
  }

  static clone(node: VariableValueNode): VariableValueNode {
    return new VariableValueNode(node.__text, node.__key)
  }

  constructor(text: string, key?: NodeKey) {
    super(text, key)
  }

  canInsertTextBefore(): boolean {
    return false
  }

  isTextEntity(): true {
    return true
  }
}

export function $createVariableValueNode(text = ''): VariableValueNode {
  return $applyNodeReplacement(new VariableValueNode(text))
}

export function $isVariableValueNode(
  node: LexicalNode | null | undefined,
): node is VariableValueNode {
  return node instanceof VariableValueNode
}
