import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { $createErrorMessageBlockNode, ErrorMessageBlockNode } from '../node'

describe('ErrorMessageBlockNode', () => {
  it('preserves the error-message placeholder through saved editor state', () => {
    const editor = createEditor({ nodes: [ErrorMessageBlockNode] })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createErrorMessageBlockNode()))
      },
      { discrete: true },
    )

    const saved = editor.getEditorState().toJSON()
    const restored = createEditor({ nodes: [ErrorMessageBlockNode] })
    restored.setEditorState(restored.parseEditorState(saved))

    restored.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('{{#error_message#}}')
      expect($getRoot().getFirstDescendant()?.exportJSON()).toEqual({
        type: 'error-message-block',
        version: 1,
      })
    })
  })
})
