import type { LexicalEditor } from 'lexical'
import type { RoleName } from './index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { $nodesOfType } from 'lexical'
import { HISTORY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  DELETE_HISTORY_BLOCK_COMMAND,
  HistoryBlock,
  HistoryBlockNode,
  INSERT_HISTORY_BLOCK_COMMAND,

} from './index'

const createRoleName = (overrides?: Partial<RoleName>): RoleName => ({
  user: 'user-role',
  assistant: 'assistant-role',
  ...overrides,
})

const renderHistoryBlock = (props?: {
  history?: RoleName
  onEditRole?: () => void
  onInsert?: () => void
  onDelete?: () => void
}) => {
  return renderLexicalEditor({
    namespace: 'history-block-plugin-test',
    nodes: [CustomTextNode, HistoryBlockNode],
    children: (
      <HistoryBlock
        history={props?.history}
        onEditRole={props?.onEditRole}
        onInsert={props?.onInsert}
        onDelete={props?.onDelete}
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

describe('HistoryBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should insert history block and call onInsert when insert command is dispatched', async () => {
    const onInsert = vi.fn()
    const onEditRole = vi.fn()
    const history = createRoleName()
    const { getEditor } = renderHistoryBlock({ onInsert, onEditRole, history })

    const editor = await waitForEditorReady(getEditor)

    selectRootEnd(editor)

    let handled = false
    act(() => {
      handled = editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    expect(onInsert).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(readRootTextContent(editor)).toBe(HISTORY_PLACEHOLDER_TEXT)
    })
    expect(getNodeCount(editor, HistoryBlockNode)).toBe(1)
    expect(getFirstNodeRoleName(editor)).toEqual(history)
  })

  it('should insert history block with default props when insert command is dispatched', async () => {
    const { getEditor } = renderHistoryBlock()

    const editor = await waitForEditorReady(getEditor)

    selectRootEnd(editor)

    let handled = false
    act(() => {
      handled = editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    await waitFor(() => {
      expect(readRootTextContent(editor)).toBe(HISTORY_PLACEHOLDER_TEXT)
    })
    expect(getNodeCount(editor, HistoryBlockNode)).toBe(1)
    expect(getFirstNodeRoleName(editor)).toEqual({
      user: '',
      assistant: '',
    })
  })

  it('should call onDelete when delete command is dispatched', async () => {
    const onDelete = vi.fn()
    const { getEditor } = renderHistoryBlock({ onDelete })

    const editor = await waitForEditorReady(getEditor)

    let handled = false
    act(() => {
      handled = editor.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should handle delete command without onDelete callback', async () => {
    const { getEditor } = renderHistoryBlock()

    const editor = await waitForEditorReady(getEditor)

    let handled = false
    act(() => {
      handled = editor.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
  })

  it('should unregister insert and delete commands when unmounted', async () => {
    const { getEditor, unmount } = renderHistoryBlock()

    const editor = await waitForEditorReady(getEditor)

    unmount()

    let insertHandled = true
    let deleteHandled = true
    act(() => {
      insertHandled = editor.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
      deleteHandled = editor.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(insertHandled).toBe(false)
    expect(deleteHandled).toBe(false)
  })

  it('should throw when history node is not registered on editor', () => {
    expect(() => {
      render(
        <LexicalComposer
          initialConfig={{
            namespace: 'history-block-plugin-missing-node-test',
            onError: (error: Error) => {
              throw error
            },
            nodes: [CustomTextNode],
          }}
        >
          <HistoryBlock />
        </LexicalComposer>,
      )
    }).toThrow('HistoryBlockPlugin: HistoryBlock not registered on editor')
  })
})
