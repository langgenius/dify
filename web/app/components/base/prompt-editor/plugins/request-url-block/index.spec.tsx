import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { REQUEST_URL_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  DELETE_REQUEST_URL_BLOCK_COMMAND,
  INSERT_REQUEST_URL_BLOCK_COMMAND,
  RequestURLBlock,
  RequestURLBlockNode,
} from './index'

const renderRequestURLBlock = (props: {
  onInsert?: () => void
  onDelete?: () => void
} = {}) => {
  return renderLexicalEditor({
    namespace: 'request-url-block-plugin-test',
    nodes: [CustomTextNode, RequestURLBlockNode],
    children: (
      <RequestURLBlock {...props} />
    ),
  })
}

describe('RequestURLBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Command handling', () => {
    it('should insert request URL block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderRequestURLBlock({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_REQUEST_URL_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(REQUEST_URL_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, RequestURLBlockNode)).toBe(1)
    })

    it('should insert request URL block without onInsert callback', async () => {
      const { getEditor } = renderRequestURLBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_REQUEST_URL_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(REQUEST_URL_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, RequestURLBlockNode)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderRequestURLBlock({ onDelete })

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_REQUEST_URL_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderRequestURLBlock()

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_REQUEST_URL_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderRequestURLBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor.dispatchCommand(INSERT_REQUEST_URL_BLOCK_COMMAND, undefined)
        deleteHandled = editor.dispatchCommand(DELETE_REQUEST_URL_BLOCK_COMMAND, undefined)
      })

      expect(insertHandled).toBe(false)
      expect(deleteHandled).toBe(false)
    })

    it('should throw when request URL node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'request-url-block-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <RequestURLBlock />
          </LexicalComposer>,
        )
      }).toThrow('RequestURLBlockPlugin: RequestURLBlock not registered on editor')
    })
  })
})
