import { act, waitFor } from '@testing-library/react'
import { ERROR_MESSAGE_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import {
  DELETE_ERROR_MESSAGE_COMMAND,
  ErrorMessageBlock,
  ErrorMessageBlockNode,
  INSERT_ERROR_MESSAGE_BLOCK_COMMAND,
} from '../index'

it('inserts an error block through the editor command and reports deletion to its owner', async () => {
  const onInsert = vi.fn()
  const onDelete = vi.fn()
  const { getEditor, unmount } = renderLexicalEditor({
    namespace: 'error-message-commands',
    nodes: [ErrorMessageBlockNode],
    children: <ErrorMessageBlock onInsert={onInsert} onDelete={onDelete} />,
  })
  const editor = await waitForEditorReady(getEditor)
  selectRootEnd(editor)
  act(() => {
    expect(editor.dispatchCommand(INSERT_ERROR_MESSAGE_BLOCK_COMMAND, undefined)).toBe(true)
  })
  await waitFor(() => expect(readRootTextContent(editor)).toBe(ERROR_MESSAGE_PLACEHOLDER_TEXT))
  expect(getNodeCount(editor, ErrorMessageBlockNode)).toBe(1)
  expect(onInsert).toHaveBeenCalledOnce()
  act(() => {
    expect(editor.dispatchCommand(DELETE_ERROR_MESSAGE_COMMAND, undefined)).toBe(true)
  })
  expect(onDelete).toHaveBeenCalledOnce()

  unmount()
  act(() => {
    expect(editor.dispatchCommand(INSERT_ERROR_MESSAGE_BLOCK_COMMAND, undefined)).toBe(false)
    expect(editor.dispatchCommand(DELETE_ERROR_MESSAGE_COMMAND, undefined)).toBe(false)
  })
  expect(onInsert).toHaveBeenCalledOnce()
  expect(onDelete).toHaveBeenCalledOnce()
})
