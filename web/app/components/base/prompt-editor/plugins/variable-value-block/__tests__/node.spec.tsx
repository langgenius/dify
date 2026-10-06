import type { Klass, LexicalEditor, LexicalNode, SerializedTextNode } from 'lexical'
import { createEditor } from 'lexical'
import { $createVariableValueBlockNode, VariableValueBlockNode } from '../node'

describe('VariableValueBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [VariableValueBlockNode as unknown as Klass<LexicalNode>],
    })
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

  it('should create node with helper', () => {
    runInEditor(() => {
      const node = $createVariableValueBlockNode('{{org_id}}')

      expect(node).toBeInstanceOf(VariableValueBlockNode)
      expect(node.getTextContent()).toBe('{{org_id}}')
    })
  })
})
