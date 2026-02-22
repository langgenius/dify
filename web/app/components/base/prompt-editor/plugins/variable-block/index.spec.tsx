import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, waitFor } from '@testing-library/react'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'
import { CustomTextNode } from '../custom-text/node'
import VariableBlock, {
  INSERT_VARIABLE_BLOCK_COMMAND,
  INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
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

const renderVariableBlock = () => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'variable-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode],
      }}
    >
      <VariableBlock />
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

const selectRoot = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
  })
}

describe('VariableBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Command handling', () => {
    it('should insert an opening brace when INSERT_VARIABLE_BLOCK_COMMAND is dispatched', async () => {
      const { getEditor } = renderVariableBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false

      act(() => {
        handled = editor!.dispatchCommand(INSERT_VARIABLE_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('{')
      })
    })

    it('should insert provided value when INSERT_VARIABLE_VALUE_BLOCK_COMMAND is dispatched', async () => {
      const { getEditor } = renderVariableBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false

      act(() => {
        handled = editor!.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, 'user.name')
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('user.name')
      })
    })
  })

  describe('Lifecycle cleanup', () => {
    it('should unregister command handlers when the plugin unmounts', async () => {
      const { getEditor, unmount } = renderVariableBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      unmount()

      let variableHandled = true
      let valueHandled = true

      act(() => {
        variableHandled = editor!.dispatchCommand(INSERT_VARIABLE_BLOCK_COMMAND, undefined)
        valueHandled = editor!.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, 'ignored')
      })

      expect(variableHandled).toBe(false)
      expect(valueHandled).toBe(false)
    })
  })
})
