import { act, waitFor } from '@testing-library/react'
import { CustomTextNode } from '../custom-text/node'
import {
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import VariableBlock, {
  INSERT_VARIABLE_BLOCK_COMMAND,
  INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
} from './index'

const renderVariableBlock = () => {
  return renderLexicalEditor({
    namespace: 'variable-block-plugin-test',
    nodes: [CustomTextNode],
    children: (
      <VariableBlock />
    ),
  })
}

describe('VariableBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Command handling', () => {
    it('should insert an opening brace when INSERT_VARIABLE_BLOCK_COMMAND is dispatched', async () => {
      const { getEditor } = renderVariableBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false

      act(() => {
        handled = editor.dispatchCommand(INSERT_VARIABLE_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe('{')
      })
    })

    it('should insert provided value when INSERT_VARIABLE_VALUE_BLOCK_COMMAND is dispatched', async () => {
      const { getEditor } = renderVariableBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false

      act(() => {
        handled = editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, 'user.name')
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe('user.name')
      })
    })
  })

  describe('Lifecycle cleanup', () => {
    it('should unregister command handlers when the plugin unmounts', async () => {
      const { getEditor, unmount } = renderVariableBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let variableHandled = true
      let valueHandled = true

      act(() => {
        variableHandled = editor.dispatchCommand(INSERT_VARIABLE_BLOCK_COMMAND, undefined)
        valueHandled = editor.dispatchCommand(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, 'ignored')
      })

      expect(variableHandled).toBe(false)
      expect(valueHandled).toBe(false)
    })
  })
})
