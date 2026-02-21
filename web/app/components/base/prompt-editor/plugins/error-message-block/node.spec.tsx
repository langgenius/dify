import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import { createEditor } from 'lexical'
import { $createErrorMessageBlockNode, $isErrorMessageBlockNode, ErrorMessageBlockNode } from './node'

describe('ErrorMessageBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [ErrorMessageBlockNode as unknown as Klass<LexicalNode>],
    })
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should expose correct static type and clone behavior', () => {
    runInEditor(() => {
      const original = new ErrorMessageBlockNode('node-key')
      const cloned = ErrorMessageBlockNode.clone(original)

      expect(ErrorMessageBlockNode.getType()).toBe('error-message-block')
      expect(cloned).toBeInstanceOf(ErrorMessageBlockNode)
      expect(cloned).not.toBe(original)
      expect(cloned.getKey()).toBe(original.getKey())
    })
  })

  it('should be inline and provide expected text and json payload', () => {
    runInEditor(() => {
      const node = new ErrorMessageBlockNode()

      expect(node.isInline()).toBe(true)
      expect(node.getTextContent()).toBe('{{#error_message#}}')
      expect(node.exportJSON()).toEqual({
        type: 'error-message-block',
        version: 1,
      })
    })
  })

  it('should create dom with expected classes and never update dom', () => {
    runInEditor(() => {
      const node = new ErrorMessageBlockNode()
      const dom = node.createDOM()

      expect(dom.tagName).toBe('DIV')
      expect(dom).toHaveClass('inline-flex')
      expect(dom).toHaveClass('items-center')
      expect(dom).toHaveClass('align-middle')
      expect(node.updateDOM()).toBe(false)
    })
  })

  it('should decorate using ErrorMessageBlockComponent with node key', () => {
    runInEditor(() => {
      const node = new ErrorMessageBlockNode('decorator-key')
      const decorated = node.decorate()

      expect(decorated.props.nodeKey).toBe('decorator-key')
    })
  })

  it('should create and import node instances via helper APIs', () => {
    runInEditor(() => {
      const created = $createErrorMessageBlockNode()
      const imported = ErrorMessageBlockNode.importJSON()

      expect(created).toBeInstanceOf(ErrorMessageBlockNode)
      expect(imported).toBeInstanceOf(ErrorMessageBlockNode)
    })
  })

  it('should return correct type guard values for lexical and non lexical inputs', () => {
    runInEditor(() => {
      const node = new ErrorMessageBlockNode()

      expect($isErrorMessageBlockNode(node)).toBe(true)
      expect($isErrorMessageBlockNode(null)).toBe(false)
      expect($isErrorMessageBlockNode(undefined)).toBe(false)
      expect($isErrorMessageBlockNode({} as ErrorMessageBlockNode)).toBe(false)
    })
  })
})
