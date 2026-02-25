import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { QUERY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import { CaptureEditorPlugin } from '../test-utils'
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
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'query-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, QueryBlockNode],
      }}
    >
      <QueryBlock {...props} />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const readEditorText = (editor: LexicalEditor) => {
  let content = ''

  editor.getEditorState().read(() => {
    content = $getRoot().getTextContent()
  })

  return content
}

const getQueryNodeCount = (editor: LexicalEditor) => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(QueryBlockNode).length
  })

  return count
}

const selectRoot = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
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

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(QUERY_PLACEHOLDER_TEXT)
      })
      expect(getQueryNodeCount(editor!)).toBe(1)
    })

    it('should insert query block without onInsert callback', async () => {
      const { getEditor } = renderQueryBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(QUERY_PLACEHOLDER_TEXT)
      })
      expect(getQueryNodeCount(editor!)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderQueryBlock({ onDelete })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderQueryBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderQueryBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor!.dispatchCommand(INSERT_QUERY_BLOCK_COMMAND, undefined)
        deleteHandled = editor!.dispatchCommand(DELETE_QUERY_BLOCK_COMMAND, undefined)
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
