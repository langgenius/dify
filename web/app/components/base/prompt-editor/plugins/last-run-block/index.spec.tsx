import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { LAST_RUN_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  DELETE_LAST_RUN_COMMAND,
  INSERT_LAST_RUN_BLOCK_COMMAND,
  LastRunBlock,
  LastRunBlockNode,
} from './index'

const renderLastRunBlock = (props?: {
  onInsert?: () => void
  onDelete?: () => void
}) => {
  return renderLexicalEditor({
    namespace: 'last-run-block-plugin-test',
    nodes: [CustomTextNode, LastRunBlockNode],
    children: (
      <LastRunBlock {...(props ?? {})} />
    ),
  })
}

describe('LastRunBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    it('should insert last run block without onInsert callback', async () => {
      const { getEditor } = renderLastRunBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
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

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderLastRunBlock()

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
      })

      expect(handled).toBe(true)
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

    it('should throw when last run node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'last-run-block-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <LastRunBlock />
          </LexicalComposer>,
        )
      }).toThrow('Last_RunBlockPlugin: Last_RunBlock not registered on editor')
    })
  })
})
