import type { LexicalEditor } from 'lexical'
import type { RoleName } from './index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { $nodesOfType } from 'lexical'
import { HISTORY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'
import HistoryBlockReplacementBlock from './history-block-replacement-block'
import { HistoryBlockNode } from './node'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    setEditorRootText(editor, `prefix ${HISTORY_PLACEHOLDER_TEXT} suffix`, text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, HistoryBlockNode)).toBe(1)
    })
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(getFirstNodeRoleName(editor)).toEqual(history)
  })

  it('should not replace text when history placeholder is absent', async () => {
    const onInsert = vi.fn()
    const { getEditor } = renderReplacementPlugin({ onInsert })

    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, 'plain text without history placeholder', text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, HistoryBlockNode)).toBe(0)
    })
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('should replace history placeholder without onInsert callback', async () => {
    const { getEditor } = renderReplacementPlugin()

    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, HISTORY_PLACEHOLDER_TEXT, text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, HistoryBlockNode)).toBe(1)
    })
  })

  it('should throw when history node is not registered on editor', () => {
    expect(() => {
      render(
        <LexicalComposer
          initialConfig={{
            namespace: 'history-block-replacement-plugin-missing-node-test',
            onError: (error: Error) => {
              throw error
            },
            nodes: [CustomTextNode],
          }}
        >
          <HistoryBlockReplacementBlock />
        </LexicalComposer>,
      )
    }).toThrow('HistoryBlockNodePlugin: HistoryBlockNode not registered on editor')
  })
})
