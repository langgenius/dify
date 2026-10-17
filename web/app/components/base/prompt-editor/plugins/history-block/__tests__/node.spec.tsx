import { $getRoot, $nodesOfType } from 'lexical'
import { createLexicalTestEditor } from '../../__tests__/test-helpers'
import { $createHistoryBlockNode, HistoryBlockNode } from '../node'

it('preserves history roles and the prompt placeholder when editor content is saved and restored', () => {
  const editor = createLexicalTestEditor('history-save', [HistoryBlockNode])
  const roleName = { user: 'Customer', assistant: 'Support' }
  editor.update(
    () => {
      $getRoot().append($createHistoryBlockNode(roleName, vi.fn()))
    },
    { discrete: true },
  )
  const saved = JSON.stringify(editor.getEditorState())
  const restored = createLexicalTestEditor('history-restore', [HistoryBlockNode])
  restored.setEditorState(restored.parseEditorState(saved))
  restored.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('{{#histories#}}')
    expect($nodesOfType(HistoryBlockNode)[0]?.getRoleName()).toEqual(roleName)
  })
})

it('keeps the edit action when editor state is transferred in memory', () => {
  const onEditRole = vi.fn()
  const editor = createLexicalTestEditor('history-action-save', [HistoryBlockNode])
  editor.update(
    () => {
      $getRoot().append(
        $createHistoryBlockNode({ user: 'Customer', assistant: 'Support' }, onEditRole),
      )
    },
    { discrete: true },
  )
  const restored = createLexicalTestEditor('history-action-restore', [HistoryBlockNode])
  restored.setEditorState(restored.parseEditorState(editor.getEditorState().toJSON()))
  const edit = restored
    .getEditorState()
    .read(() => $nodesOfType(HistoryBlockNode)[0]!.getOnEditRole())
  edit()
  expect(onEditRole).toHaveBeenCalledOnce()
})
