import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, waitFor } from '@testing-library/react'
import {
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { useEffect } from 'react'
import { LAST_RUN_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  DELETE_LAST_RUN_COMMAND,
  INSERT_LAST_RUN_BLOCK_COMMAND,
  LastRunBlock,
  LastRunBlockNode,
} from './index'

type CaptureEditorPluginProps = {
  onReady: (editor: LexicalEditor) => void
}

const CaptureEditorPlugin = ({ onReady }: CaptureEditorPluginProps) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}

const renderLastRunBlock = (props?: {
  onInsert?: () => void
  onDelete?: () => void
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'last-run-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, LastRunBlockNode],
      }}
    >
      <LastRunBlock {...(props ?? {})} />
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

const getLastRunNodeCount = (editor: LexicalEditor) => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(LastRunBlockNode).length
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

describe('LastRunBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Command handling', () => {
    it('should insert last run block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderLastRunBlock({ onInsert })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(LAST_RUN_PLACEHOLDER_TEXT)
      })
      expect(getLastRunNodeCount(editor!)).toBe(1)
    })

    it('should insert last run block without onInsert callback', async () => {
      const { getEditor } = renderLastRunBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(LAST_RUN_PLACEHOLDER_TEXT)
      })
      expect(getLastRunNodeCount(editor!)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderLastRunBlock({ onDelete })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderLastRunBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderLastRunBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor!.dispatchCommand(INSERT_LAST_RUN_BLOCK_COMMAND, undefined)
        deleteHandled = editor!.dispatchCommand(DELETE_LAST_RUN_COMMAND, undefined)
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
