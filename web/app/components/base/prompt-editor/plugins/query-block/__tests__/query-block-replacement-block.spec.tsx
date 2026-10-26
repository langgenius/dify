import { waitFor } from '@testing-library/react'
import { QUERY_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import { QueryBlockNode } from '../index'
import QueryBlockReplacementBlock from '../query-block-replacement-block'

const renderReplacementPlugin = (
  props: {
    onInsert?: () => void
  } = {},
) => {
  return renderLexicalEditor({
    namespace: 'query-block-replacement-plugin-test',
    nodes: [CustomTextNode, QueryBlockNode],
    children: <QueryBlockReplacementBlock {...props} />,
  })
}

describe('QueryBlockReplacementBlock', () => {
  describe('Replacement behavior', () => {
    it('should replace placeholder text with query block and call onInsert', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(
        editor,
        `prefix ${QUERY_PLACEHOLDER_TEXT} suffix`,
        (text) => new CustomTextNode(text),
      )

      await waitFor(() => {
        expect(getNodeCount(editor, QueryBlockNode)).toBe(1)
      })
      expect(onInsert).toHaveBeenCalledTimes(1)
      expect(readRootTextContent(editor)).toBe(`prefix ${QUERY_PLACEHOLDER_TEXT} suffix`)
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
      expect(getNodeCount(editor, QueryBlockNode)).toBe(0)
      expect(onInsert).not.toHaveBeenCalled()
    })
  })
})
