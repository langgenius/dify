import { waitFor } from '@testing-library/react'
import { ERROR_MESSAGE_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import ErrorMessageBlockReplacementBlock from '../error-message-block-replacement-block'
import { ErrorMessageBlockNode } from '../node'

it('replaces the error placeholder while preserving surrounding text and reporting insertion', async () => {
  const onInsert = vi.fn()
  const { getEditor } = renderLexicalEditor({
    namespace: 'error-message-replacement',
    nodes: [CustomTextNode, ErrorMessageBlockNode],
    children: <ErrorMessageBlockReplacementBlock onInsert={onInsert} />,
  })
  const editor = await waitForEditorReady(getEditor)
  setEditorRootText(
    editor,
    `prefix ${ERROR_MESSAGE_PLACEHOLDER_TEXT} suffix`,
    (text) => new CustomTextNode(text),
  )
  await waitFor(() => expect(getNodeCount(editor, ErrorMessageBlockNode)).toBe(1))
  expect(readRootTextContent(editor)).toBe(`prefix ${ERROR_MESSAGE_PLACEHOLDER_TEXT} suffix`)
  expect(onInsert).toHaveBeenCalledOnce()
})

it('leaves ordinary prompt text unchanged without reporting an insertion', async () => {
  const onInsert = vi.fn()
  const { getEditor } = renderLexicalEditor({
    namespace: 'error-message-plain-text',
    nodes: [CustomTextNode, ErrorMessageBlockNode],
    children: <ErrorMessageBlockReplacementBlock onInsert={onInsert} />,
  })
  const editor = await waitForEditorReady(getEditor)
  setEditorRootText(editor, 'plain prompt text', (text) => new CustomTextNode(text))
  await waitFor(() => expect(readRootTextContent(editor)).toBe('plain prompt text'))
  expect(getNodeCount(editor, ErrorMessageBlockNode)).toBe(0)
  expect(onInsert).not.toHaveBeenCalled()
})
