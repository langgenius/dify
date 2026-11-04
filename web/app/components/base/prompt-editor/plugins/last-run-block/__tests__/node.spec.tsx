import { $createParagraphNode, $getRoot } from 'lexical'
import { createLexicalTestEditor, readRootTextContent } from '../../__tests__/test-helpers'
import { $createLastRunBlockNode, LastRunBlockNode } from '../node'

it('preserves the placeholder through a serialized editor-state round trip', () => {
  const editor = createLexicalTestEditor('source', [LastRunBlockNode])
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createLastRunBlockNode()))
    },
    { discrete: true },
  )
  const saved = editor.getEditorState().toJSON()
  expect(saved.root.children[0]).toMatchObject({
    children: [{ type: 'last-run-block', version: 1 }],
  })
  const restored = createLexicalTestEditor('restored', [LastRunBlockNode])
  restored.setEditorState(restored.parseEditorState(JSON.stringify(saved)))
  expect(readRootTextContent(restored)).toBe('{{#last_run#}}')
})
