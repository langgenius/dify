import { $createParagraphNode, $getRoot } from 'lexical'
import { createLexicalTestEditor, readRootTextContent } from '../../__tests__/test-helpers'
import { $createRequestURLBlockNode, RequestURLBlockNode } from '../node'

it('preserves the placeholder through a serialized editor-state round trip', () => {
  const editor = createLexicalTestEditor('source', [RequestURLBlockNode])
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createRequestURLBlockNode()))
    },
    { discrete: true },
  )
  const saved = editor.getEditorState().toJSON()
  expect(saved.root.children[0]).toMatchObject({
    children: [{ type: 'request-url-block', version: 1 }],
  })
  const restored = createLexicalTestEditor('restored', [RequestURLBlockNode])
  restored.setEditorState(restored.parseEditorState(JSON.stringify(saved)))
  expect(readRootTextContent(restored)).toBe('{{#url#}}')
})
