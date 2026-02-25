import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { LAST_RUN_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'
import { LastRunBlockNode } from './index'
import LastRunReplacementBlock from './last-run-block-replacement-block'

const renderReplacementPlugin = (props?: {
  onInsert?: () => void
}) => {
  return renderLexicalEditor({
    namespace: 'last-run-block-replacement-plugin-test',
    nodes: [CustomTextNode, LastRunBlockNode],
    children: (
      <LastRunReplacementBlock {...(props ?? {})} />
    ),
  })
}

describe('LastRunReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Replacement behavior', () => {
    it('should replace placeholder text with last run block and call onInsert', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, `prefix ${LAST_RUN_PLACEHOLDER_TEXT} suffix`, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, LastRunBlockNode)).toBe(1)
      })
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'plain text without placeholder', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, LastRunBlockNode)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })

    it('should replace placeholder text without onInsert callback', async () => {
      const { getEditor } = renderReplacementPlugin()

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, LAST_RUN_PLACEHOLDER_TEXT, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, LastRunBlockNode)).toBe(1)
      })
    })
  })

  describe('Node registration guard', () => {
    it('should throw when last run node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'last-run-block-replacement-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <LastRunReplacementBlock />
          </LexicalComposer>,
        )
      }).toThrow('LastRunMessageBlockNodePlugin: LastRunMessageBlockNode not registered on editor')
    })
  })
})
