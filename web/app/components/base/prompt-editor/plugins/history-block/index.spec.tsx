import type { LexicalEditor } from 'lexical'
import type { RoleName } from './index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { HISTORY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import { CaptureEditorPlugin } from '../test-utils'
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
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'history-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, HistoryBlockNode],
      }}
    >
      <HistoryBlock
        history={props?.history}
        onEditRole={props?.onEditRole}
        onInsert={props?.onInsert}
        onDelete={props?.onDelete}
      />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const selectRoot = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
  })
}

const readEditorText = (editor: LexicalEditor) => {
  let content = ''

  editor.getEditorState().read(() => {
    content = $getRoot().getTextContent()
  })

  return content
}

const getHistoryNodeCount = (editor: LexicalEditor) => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(HistoryBlockNode).length
  })

  return count
}

const getFirstNodeRoleName = (editor: LexicalEditor) => {
  let roleName: RoleName | null = null

  editor.getEditorState().read(() => {
    const node = $nodesOfType(HistoryBlockNode)[0]
    roleName = node?.getRoleName() ?? null
  })

  return roleName
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

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    selectRoot(editor!)

    let handled = false
    act(() => {
      handled = editor!.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    expect(onInsert).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(readEditorText(editor!)).toBe(HISTORY_PLACEHOLDER_TEXT)
    })
    expect(getHistoryNodeCount(editor!)).toBe(1)
    expect(getFirstNodeRoleName(editor!)).toEqual(history)
  })

  it('should insert history block with default props when insert command is dispatched', async () => {
    const { getEditor } = renderHistoryBlock()

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    selectRoot(editor!)

    let handled = false
    act(() => {
      handled = editor!.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    await waitFor(() => {
      expect(readEditorText(editor!)).toBe(HISTORY_PLACEHOLDER_TEXT)
    })
    expect(getHistoryNodeCount(editor!)).toBe(1)
    expect(getFirstNodeRoleName(editor!)).toEqual({
      user: '',
      assistant: '',
    })
  })

  it('should call onDelete when delete command is dispatched', async () => {
    const onDelete = vi.fn()
    const { getEditor } = renderHistoryBlock({ onDelete })

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    let handled = false
    act(() => {
      handled = editor!.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should handle delete command without onDelete callback', async () => {
    const { getEditor } = renderHistoryBlock()

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    let handled = false
    act(() => {
      handled = editor!.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
    })

    expect(handled).toBe(true)
  })

  it('should unregister insert and delete commands when unmounted', async () => {
    const { getEditor, unmount } = renderHistoryBlock()

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    unmount()

    let insertHandled = true
    let deleteHandled = true
    act(() => {
      insertHandled = editor!.dispatchCommand(INSERT_HISTORY_BLOCK_COMMAND, undefined)
      deleteHandled = editor!.dispatchCommand(DELETE_HISTORY_BLOCK_COMMAND, undefined)
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
