import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { REQUEST_URL_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'
import { RequestURLBlockNode } from './index'
import RequestURLBlockReplacementBlock from './request-url-block-replacement-block'

const renderReplacementPlugin = (props: {
  onInsert?: () => void
} = {}) => {
  return renderLexicalEditor({
    namespace: 'request-url-block-replacement-plugin-test',
    nodes: [CustomTextNode, RequestURLBlockNode],
    children: (
      <RequestURLBlockReplacementBlock {...props} />
    ),
  })
}

describe('RequestURLBlockReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Replacement behavior', () => {
    it('should replace placeholder text with request URL block and call onInsert', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, `prefix ${REQUEST_URL_PLACEHOLDER_TEXT} suffix`, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, RequestURLBlockNode)).toBe(1)
      })
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'plain text without placeholder', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, RequestURLBlockNode)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })

    it('should replace placeholder text without onInsert callback', async () => {
      const { getEditor } = renderReplacementPlugin()

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, REQUEST_URL_PLACEHOLDER_TEXT, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, RequestURLBlockNode)).toBe(1)
      })
    })
  })

  describe('Node registration guard', () => {
    it('should throw when request URL node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'request-url-block-replacement-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <RequestURLBlockReplacementBlock />
          </LexicalComposer>,
        )
      }).toThrow('RequestURLBlockNodePlugin: RequestURLBlockNode not registered on editor')
    })
  })
})
