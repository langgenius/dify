import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { createTestEditor, withEditorUpdate } from './utils'

describe('Prompt editor test utilities', () => {
  it('commits updates synchronously and isolates editor state', () => {
    const editor = createTestEditor()
    const otherEditor = createTestEditor()
    withEditorUpdate(editor, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('First')))
    })
    withEditorUpdate(editor, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('Second')))
    })
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('First\n\nSecond')
    expect(otherEditor.getEditorState().read(() => $getRoot().getTextContent())).toBe('')
  })

  it('surfaces editor errors to the calling test', () => {
    const editor = createTestEditor()
    expect(() =>
      withEditorUpdate(editor, () => {
        throw new Error('Invalid editor update')
      }),
    ).toThrow('Invalid editor update')
  })
})
