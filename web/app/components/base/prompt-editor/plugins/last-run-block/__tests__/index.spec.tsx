import { act, waitFor } from '@testing-library/react'
import { LAST_RUN_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import {
  DELETE_LAST_RUN_COMMAND,
  INSERT_LAST_RUN_BLOCK_COMMAND,
  LastRunBlock,
  LastRunBlockNode,
} from '../index'

const renderLastRunBlock = (props?: { onInsert?: () => void; onDelete?: () => void }) => {
  return renderLexicalEditor({
    namespace: 'last-run-block-plugin-test',
    nodes: [CustomTextNode, LastRunBlockNode],
    children: <LastRunBlock {...(props ?? {})} />,
  })
}

describe('LastRunBlock', () => {
  describe('Command handling', () => {
    it('should insert last run block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderLastRunBlock({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(LAST_RUN_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, LastRunBlockNode)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderLastRunBlock({ onDelete })

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderLastRunBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
        deleteHandled = editor.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
      })

      expect(insertHandled).toBe(false)
      expect(deleteHandled).toBe(false)
    })
  })
})
