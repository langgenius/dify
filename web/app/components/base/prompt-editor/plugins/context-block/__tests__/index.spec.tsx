import { act, waitFor } from '@testing-library/react'
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical'
import {
  readEditorStateValue,
  renderLexicalEditor,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { ContextBlock, DELETE_CONTEXT_BLOCK_COMMAND, INSERT_CONTEXT_BLOCK_COMMAND } from '../index'
import { ContextBlockNode } from '../node'

it('inserts a real context node with datasets and restrictions, then notifies deletion', async () => {
  const datasets = [{ id: 'dataset-1', name: 'Knowledge', type: 'text' }]
  const onInsert = vi.fn()
  const onDelete = vi.fn()
  const onAddContext = vi.fn()
  const { getEditor, unmount } = renderLexicalEditor({
    namespace: 'context-command',
    nodes: [ContextBlockNode],
    children: (
      <ContextBlock
        datasets={datasets}
        canNotAddContext
        onInsert={onInsert}
        onDelete={onDelete}
        onAddContext={onAddContext}
      />
    ),
  })
  const editor = await waitForEditorReady(getEditor)
  act(() =>
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().clear().append(paragraph)
        paragraph.select()
        editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
      },
      { discrete: true },
    ),
  )
  await waitFor(() =>
    expect(readEditorStateValue(editor, () => $nodesOfType(ContextBlockNode).length)).toBe(1),
  )
  expect(
    readEditorStateValue(editor, () => $nodesOfType(ContextBlockNode)[0]!.exportJSON()),
  ).toEqual({
    type: 'context-block',
    version: 1,
    datasets,
    canNotAddContext: true,
    onAddContext,
  })
  expect(readEditorStateValue(editor, () => $getRoot().getTextContent())).toBe('{{#context#}}')
  expect(onInsert).toHaveBeenCalledOnce()
  act(() => {
    editor.dispatchCommand(DELETE_CONTEXT_BLOCK_COMMAND, undefined)
  })
  expect(onDelete).toHaveBeenCalledOnce()
  unmount()
  expect(editor.dispatchCommand(DELETE_CONTEXT_BLOCK_COMMAND, undefined)).toBe(false)
  expect(editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)).toBe(false)
  expect(onInsert).toHaveBeenCalledOnce()
  expect(onDelete).toHaveBeenCalledOnce()
})

it('reports missing node registration', () => {
  expect(() =>
    renderLexicalEditor({ namespace: 'missing-context', children: <ContextBlock /> }),
  ).toThrow('ContextBlockPlugin: ContextBlock not registered on editor')
})
