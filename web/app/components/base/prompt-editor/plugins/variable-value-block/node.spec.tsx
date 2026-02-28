import type { EditorConfig, Klass, LexicalEditor, LexicalNode, SerializedTextNode } from 'lexical'
import { createEditor } from 'lexical'
import {
  $createVariableValueBlockNode,
  $isVariableValueNodeBlock,
  VariableValueBlockNode,
} from './node'

describe('VariableValueBlockNode', () => {
  let editor: LexicalEditor
  let config: EditorConfig

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [VariableValueBlockNode as unknown as Klass<LexicalNode>],
    })
    config = editor._config
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should expose static type and clone with same text/key', () => {
    runInEditor(() => {
      const original = new VariableValueBlockNode('value-text', 'node-key')
      const cloned = VariableValueBlockNode.clone(original)

      expect(VariableValueBlockNode.getType()).toBe('variable-value-block')
      expect(cloned).toBeInstanceOf(VariableValueBlockNode)
      expect(cloned).not.toBe(original)
      expect(cloned.getKey()).toBe('node-key')
    })
  })

  it('should add block classes in createDOM and disallow text insertion before', () => {
    runInEditor(() => {
      const node = new VariableValueBlockNode('hello')
      const dom = node.createDOM(config)

      expect(dom).toHaveClass('inline-flex')
      expect(dom).toHaveClass('items-center')
      expect(dom).toHaveClass('px-0.5')
      expect(dom).toHaveClass('h-[22px]')
      expect(dom).toHaveClass('text-text-accent')
      expect(dom).toHaveClass('rounded-[5px]')
      expect(dom).toHaveClass('align-middle')
      expect(node.canInsertTextBefore()).toBe(false)
    })
  })

  it('should import serialized node and preserve text metadata in export', () => {
    runInEditor(() => {
      const serialized = {
        detail: 2,
        format: 1,
        mode: 'token',
        style: 'color:red;',
        text: '{{profile_name}}',
        type: 'text',
        version: 1,
      } as SerializedTextNode

      const imported = VariableValueBlockNode.importJSON(serialized)
      const exported = imported.exportJSON()

      expect(exported).toEqual({
        detail: 2,
        format: 1,
        mode: 'token',
        style: 'color:red;',
        text: '{{profile_name}}',
        type: 'variable-value-block',
        version: 1,
      })
    })
  })

  it('should create node with helper and support type guard checks', () => {
    runInEditor(() => {
      const node = $createVariableValueBlockNode('{{org_id}}')

      expect(node).toBeInstanceOf(VariableValueBlockNode)
      expect(node.getTextContent()).toBe('{{org_id}}')
      expect($isVariableValueNodeBlock(node)).toBe(true)
      expect($isVariableValueNodeBlock(null)).toBe(false)
      expect($isVariableValueNodeBlock(undefined)).toBe(false)
      expect($isVariableValueNodeBlock({} as LexicalNode)).toBe(false)
    })
  })
})
