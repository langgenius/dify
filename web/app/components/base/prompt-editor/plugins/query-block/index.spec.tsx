import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { QUERY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  DELETE_QUERY_BLOCK_COMMAND,
  INSERT_QUERY_BLOCK_COMMAND,
  QueryBlock,
  QueryBlockNode,
} from './index'

const renderQueryBlock = (props: {
  onInsert?: () => void
  onDelete?: () => void
} = {}) => {
  return renderLexicalEditor({
    namespace: 'query-block-plugin-test',
    nodes: [CustomTextNode, QueryBlockNode],
    children: (
      <QueryBlock {...props} />
    ),
  })
}

describe('QueryBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    it('should insert query block without onInsert callback', async () => {
      const { getEditor } = renderQueryBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
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

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderQueryBlock()

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
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

    it('should throw when query node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'query-block-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <QueryBlock />
          </LexicalComposer>,
        )
      }).toThrow('QueryBlockPlugin: QueryBlock not registered on editor')
    })
  })
})
