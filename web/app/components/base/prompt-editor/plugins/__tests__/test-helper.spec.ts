import { waitFor } from '@testing-library/react'
import { $createTextNode, $getSelection, $isRangeSelection, ParagraphNode, TextNode } from 'lexical'
import {
  createLexicalTestEditor,
  getNodeCount,
  getNodesByType,
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from './test-helpers'

it('replaces editor content and leaves a collapsed selection at the new text end', async () => {
  const { getEditor } = renderLexicalEditor({ namespace: 'helper-contract', children: null })
  const editor = await waitForEditorReady(getEditor)
  setEditorRootText(editor, 'Old content', $createTextNode)
  await waitFor(() => expect(readRootTextContent(editor)).toBe('Old content'))
  setEditorRootText(editor, 'Replacement', $createTextNode)
  await waitFor(() => expect(readRootTextContent(editor)).toBe('Replacement'))
  expect(getNodeCount(editor, ParagraphNode)).toBe(1)
  expect(
    readEditorStateValue(editor, () =>
      getNodesByType(editor, TextNode).map((node) => node.getTextContent()),
    ),
  ).toEqual(['Replacement'])
  expect(
    readEditorStateValue(editor, () => {
      const selection = $getSelection()
      return (
        $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 11
      )
    }),
  ).toBe(true)
})

it('surfaces editor update failures and missing read results to the calling test', () => {
  const editor = createLexicalTestEditor('helper-errors', [ParagraphNode, TextNode])
  expect(() =>
    editor.update(
      () => {
        throw new Error('Invalid editor update')
      },
      { discrete: true },
    ),
  ).toThrow('Invalid editor update')
  expect(() => readEditorStateValue(editor, () => undefined)).toThrow(
    'Failed to read editor state value',
  )
})
