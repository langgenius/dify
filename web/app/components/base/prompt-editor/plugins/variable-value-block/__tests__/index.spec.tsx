import { waitFor } from '@testing-library/react'
import {
  getNodesByType,
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { $createCustomTextNode, CustomTextNode } from '../../custom-text/node'
import VariableValueBlock from '../index'
import { VariableValueBlockNode } from '../node'

it('recognizes placeholders inside text without consuming surrounding content', async () => {
  const { getEditor } = renderLexicalEditor({
    namespace: 'variable-value-block-test',
    nodes: [VariableValueBlockNode, CustomTextNode],
    children: <VariableValueBlock />,
  })
  const editor = await waitForEditorReady(getEditor)
  const text = 'prefix {{foo_1}} and {{account_id}} suffix'
  setEditorRootText(editor, text, $createCustomTextNode)
  await waitFor(() =>
    expect(
      readEditorStateValue(editor, () =>
        getNodesByType(editor, VariableValueBlockNode).map((node) => node.getTextContent()),
      ),
    ).toEqual(['{{foo_1}}', '{{account_id}}']),
  )
  expect(readRootTextContent(editor)).toBe(text)

  setEditorRootText(editor, 'plain text without a placeholder', $createCustomTextNode)
  await waitFor(() => expect(getNodesByType(editor, VariableValueBlockNode)).toHaveLength(0))
  expect(readRootTextContent(editor)).toBe('plain text without a placeholder')
})
