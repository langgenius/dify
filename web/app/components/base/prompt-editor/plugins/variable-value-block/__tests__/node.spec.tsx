import type { LexicalEditor, SerializedTextNode } from 'lexical'
import { $createTextNode, createEditor } from 'lexical'
import { VariableValueBlockNode } from '../node'

describe('VariableValueBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    editor = createEditor({
      nodes: [VariableValueBlockNode],
    })
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should import serialized node and preserve text metadata in export', () => {
    runInEditor(() => {
      const serialized: SerializedTextNode = {
        ...$createTextNode('{{profile_name}}').exportJSON(),
        detail: 2,
        format: 1,
        mode: 'token',
        style: 'color:red;',
      }

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
})
