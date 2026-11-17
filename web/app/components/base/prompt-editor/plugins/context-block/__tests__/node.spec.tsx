import { $createTextNode, $getRoot } from 'lexical'
import { createTestEditor, withEditorUpdate } from '../../__tests__/utils'
import { $createContextBlockNode, $isContextBlockNode, ContextBlockNode } from '../node'

const datasets = [
  { id: '1', name: 'Dataset A', type: 'text' },
  { id: '2', name: 'Dataset B', type: 'text' },
]

it.each([true, false])(
  'preserves datasets, edit permission %s and callback through clone and serialization',
  (canNotAddContext) => {
    const onAddContext = vi.fn()
    const editor = createTestEditor([ContextBlockNode])
    withEditorUpdate(editor, () => {
      const node = $createContextBlockNode(datasets, onAddContext, canNotAddContext)
      $getRoot().append(node)
      const serialized = {
        type: 'context-block',
        version: 1,
        datasets,
        onAddContext,
        canNotAddContext,
      }
      expect(node.exportJSON()).toEqual(serialized)
      expect(ContextBlockNode.clone(node).exportJSON()).toEqual(serialized)
      const imported = ContextBlockNode.importJSON(serialized)
      $getRoot().append(imported)
      expect(imported.exportJSON()).toEqual(serialized)
      expect(imported.getTextContent()).toBe('{{#context#}}')
      imported.getOnAddContext()()
      expect(onAddContext).toHaveBeenCalledOnce()
    })
  },
)

it('defaults an empty context to editable and distinguishes context nodes from ordinary text', () => {
  const editor = createTestEditor([ContextBlockNode])
  withEditorUpdate(editor, () => {
    const node = $createContextBlockNode([], vi.fn())
    $getRoot().append(node)
    expect(node.getDatasets()).toEqual([])
    expect(node.getCanNotAddContext()).toBe(false)
    expect($isContextBlockNode(node)).toBe(true)
    expect($isContextBlockNode($createTextNode('plain text'))).toBe(false)
    expect($isContextBlockNode(null)).toBe(false)
  })
})
