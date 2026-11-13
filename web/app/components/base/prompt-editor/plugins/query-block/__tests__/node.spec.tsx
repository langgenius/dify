import { $createParagraphNode, $getRoot } from 'lexical'
import { createLexicalTestEditor, readRootTextContent } from '../../__tests__/test-helpers'
import { $createQueryBlockNode, QueryBlockNode } from '../node'

it('preserves the placeholder through a serialized editor-state round trip', () => {
  const editor = createLexicalTestEditor('source', [QueryBlockNode])
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createQueryBlockNode()))
    },
    { discrete: true },
  )
  const saved = editor.getEditorState().toJSON()
  expect(saved.root.children[0]).toMatchObject({
    children: [{ type: 'query-block', version: 1 }],
  })
  const restored = createLexicalTestEditor('restored', [QueryBlockNode])
  restored.setEditorState(restored.parseEditorState(JSON.stringify(saved)))
  expect(readRootTextContent(restored)).toBe('{{#query#}}')
})
