import type { LexicalEditor } from 'lexical'
import type { RoleName } from './index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { HISTORY_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import { CaptureEditorPlugin } from '../test-utils'
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
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'history-block-replacement-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, HistoryBlockNode],
      }}
    >
      <HistoryBlockReplacementBlock
        history={props?.history}
        onEditRole={props?.onEditRole}
        onInsert={props?.onInsert}
      />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const setEditorText = (editor: LexicalEditor, text: string) => {
  act(() => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      paragraph.append(new CustomTextNode(text))
      root.append(paragraph)
      paragraph.selectEnd()
    })
  })
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

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    setEditorText(editor!, `prefix ${HISTORY_PLACEHOLDER_TEXT} suffix`)

    await waitFor(() => {
      expect(getHistoryNodeCount(editor!)).toBe(1)
    })
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(getFirstNodeRoleName(editor!)).toEqual(history)
  })

  it('should not replace text when history placeholder is absent', async () => {
    const onInsert = vi.fn()
    const { getEditor } = renderReplacementPlugin({ onInsert })

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    setEditorText(editor!, 'plain text without history placeholder')

    await waitFor(() => {
      expect(getHistoryNodeCount(editor!)).toBe(0)
    })
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('should replace history placeholder without onInsert callback', async () => {
    const { getEditor } = renderReplacementPlugin()

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })

    const editor = getEditor()
    expect(editor).not.toBeNull()

    setEditorText(editor!, HISTORY_PLACEHOLDER_TEXT)

    await waitFor(() => {
      expect(getHistoryNodeCount(editor!)).toBe(1)
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
