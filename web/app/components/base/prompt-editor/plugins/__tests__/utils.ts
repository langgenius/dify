import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import { createEditor } from 'lexical'

export function createTestEditor(nodes: Array<Klass<LexicalNode>> = []) {
  const editor = createEditor({
    nodes,
    onError: (error) => { throw error },
  })
  const root = document.createElement('div')
  editor.setRootElement(root)
  return editor
}

export function withEditorUpdate(
  editor: LexicalEditor,
  fn: () => void,
) {
  editor.update(fn, { discrete: true })
}
