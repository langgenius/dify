import { act, waitFor } from '@testing-library/react'
import { QUERY_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import {
  DELETE_QUERY_BLOCK_COMMAND,
  INSERT_QUERY_BLOCK_COMMAND,
  QueryBlock,
  QueryBlockNode,
} from '../index'

const renderQueryBlock = (
  props: {
    onInsert?: () => void
    onDelete?: () => void
  } = {},
) => {
  return renderLexicalEditor({
    namespace: 'query-block-plugin-test',
    nodes: [CustomTextNode, QueryBlockNode],
    children: <QueryBlock {...props} />,
  })
}

describe('QueryBlock', () => {
  describe('Command handling', () => {
    it('should insert query block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderQueryBlock({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(QUERY_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, QueryBlockNode)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderQueryBlock({ onDelete })

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderQueryBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
        deleteHandled = editor.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(insertHandled).toBe(false)
      expect(deleteHandled).toBe(false)
    })
  })
})
