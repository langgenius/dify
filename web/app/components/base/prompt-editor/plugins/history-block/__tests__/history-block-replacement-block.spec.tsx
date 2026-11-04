import type { LexicalEditor } from 'lexical'
import type { RoleName } from '../index'
import { waitFor } from '@testing-library/react'
import { $getRoot, $nodesOfType } from 'lexical'
import { HISTORY_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import HistoryBlockReplacementBlock from '../history-block-replacement-block'
import { HistoryBlockNode } from '../node'

const createRoleName = (overrides?: Partial<RoleName>): RoleName => ({
  user: 'user-role',
  assistant: 'assistant-role',
  ...overrides,
})

const renderReplacementPlugin = (props?: {
  history?: RoleName
  onEditRole?: () => void
  onInsert?: () => void
}) => {
  return renderLexicalEditor({
    namespace: 'history-block-replacement-plugin-test',
    nodes: [CustomTextNode, HistoryBlockNode],
    children: (
      <HistoryBlockReplacementBlock
        history={props?.history}
        onEditRole={props?.onEditRole}
        onInsert={props?.onInsert}
      />
    ),
  })
}

const getFirstNodeRoleName = (editor: LexicalEditor) => {
  return readEditorStateValue(editor, () => {
    const node = $nodesOfType(HistoryBlockNode)[0]
    return node?.getRoleName() ?? null
  })
}

describe('HistoryBlockReplacementBlock', () => {
  it('should replace history placeholder and call onInsert', async () => {
    const onInsert = vi.fn()
    const history = createRoleName()
    const onEditRole = vi.fn()
    const { getEditor } = renderReplacementPlugin({
      onInsert,
      history,
      onEditRole,
    })

    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(
      editor,
      `prefix ${HISTORY_PLACEHOLDER_TEXT} suffix`,
      (text) => new CustomTextNode(text),
    )

    await waitFor(() => {
      expect(getNodeCount(editor, HistoryBlockNode)).toBe(1)
    })
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(getFirstNodeRoleName(editor)).toEqual(history)
    expect(readEditorStateValue(editor, () => $getRoot().getTextContent())).toBe(
      `prefix ${HISTORY_PLACEHOLDER_TEXT} suffix`,
    )
  })

  it('should not replace text when history placeholder is absent', async () => {
    const onInsert = vi.fn()
    const { getEditor } = renderReplacementPlugin({ onInsert })

    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(
      editor,
      'plain text without history placeholder',
      (text) => new CustomTextNode(text),
    )

    await waitFor(() => {
      expect(getNodeCount(editor, HistoryBlockNode)).toBe(0)
    })
    expect(onInsert).not.toHaveBeenCalled()
  })
})
