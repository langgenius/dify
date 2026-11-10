import { waitFor } from '@testing-library/react'
import { REQUEST_URL_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import { RequestURLBlockNode } from '../index'
import RequestURLBlockReplacementBlock from '../request-url-block-replacement-block'

const renderReplacementPlugin = (
  props: {
    onInsert?: () => void
  } = {},
) => {
  return renderLexicalEditor({
    namespace: 'request-url-block-replacement-plugin-test',
    nodes: [CustomTextNode, RequestURLBlockNode],
    children: <RequestURLBlockReplacementBlock {...props} />,
  })
}

describe('RequestURLBlockReplacementBlock', () => {
  describe('Replacement behavior', () => {
    it('should replace placeholder text with request URL block and call onInsert', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(
        editor,
        `prefix ${REQUEST_URL_PLACEHOLDER_TEXT} suffix`,
        (text) => new CustomTextNode(text),
      )

      await waitFor(() => {
        expect(getNodeCount(editor, RequestURLBlockNode)).toBe(1)
      })
      expect(onInsert).toHaveBeenCalledTimes(1)
      expect(readRootTextContent(editor)).toBe(`prefix ${REQUEST_URL_PLACEHOLDER_TEXT} suffix`)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(
        editor,
        'plain text without placeholder',
        (text) => new CustomTextNode(text),
      )

      await waitFor(() =>
        expect(readRootTextContent(editor)).toBe('plain text without placeholder'),
      )
      expect(getNodeCount(editor, RequestURLBlockNode)).toBe(0)
      expect(onInsert).not.toHaveBeenCalled()
    })
  })
})
