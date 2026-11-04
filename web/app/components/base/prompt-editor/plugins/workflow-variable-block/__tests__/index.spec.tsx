import { act, waitFor } from '@testing-library/react'
import {
  getNodesByType,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import {
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  WorkflowVariableBlock,
  WorkflowVariableBlockNode,
} from '../index'

it('inserts a workflow variable into the real editor and forwards deletion notifications', async () => {
  const onInsert = vi.fn()
  const onDelete = vi.fn()
  const { getEditor, unmount } = renderLexicalEditor({
    namespace: 'workflow-variable-plugin',
    nodes: [CustomTextNode, WorkflowVariableBlockNode],
    children: <WorkflowVariableBlock onInsert={onInsert} onDelete={onDelete} />,
  })
  const editor = await waitForEditorReady(getEditor)
  selectRootEnd(editor)
  act(() => {
    editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, ['node-1', 'answer'])
  })
  await waitFor(() => expect(readRootTextContent(editor)).toBe('{{#node-1.answer#}}'))
  expect(getNodesByType(editor, WorkflowVariableBlockNode)).toHaveLength(1)
  expect(onInsert).toHaveBeenCalledOnce()
  act(() => {
    editor.dispatchCommand(DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND, undefined)
  })
  expect(onDelete).toHaveBeenCalledOnce()

  unmount()
  act(() => {
    expect(
      editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, ['node-2', 'answer']),
    ).toBe(false)
    expect(editor.dispatchCommand(DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND, undefined)).toBe(false)
  })
  expect(onInsert).toHaveBeenCalledOnce()
  expect(onDelete).toHaveBeenCalledOnce()
})
