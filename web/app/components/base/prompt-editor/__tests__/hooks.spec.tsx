import type {
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  $createParagraphNode,
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  createEditor,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  TextNode,
} from 'lexical'
import { useEffect } from 'react'
import {
  useBasicTypeaheadTriggerMatch,
  useLexicalTextEntity,
  useSelectOrDelete,
  useTrigger,
} from '../hooks'
import { DELETE_CONTEXT_BLOCK_COMMAND } from '../plugins/context-block'
import { ContextBlockNode } from '../plugins/context-block/node'
import { CustomTextNode } from '../plugins/custom-text/node'
import { DELETE_HISTORY_BLOCK_COMMAND } from '../plugins/history-block'
import { HistoryBlockNode } from '../plugins/history-block/node'
import { DELETE_QUERY_BLOCK_COMMAND } from '../plugins/query-block'
import { QueryBlockNode } from '../plugins/query-block/node'

class MentionNode extends TextNode {
  static override getType() {
    return 'test-mention'
  }
  static override clone(node: MentionNode) {
    return new MentionNode(node.__text, node.__key)
  }
  static override importJSON(node: SerializedTextNode) {
    return new MentionNode(node.text)
  }
  override isTextEntity() {
    return true
  }
}

const matchMention = (text: string) => {
  const match = /@[a-z]+/.exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}
const createMention = (node: CustomTextNode) => new MentionNode(node.getTextContent())

function EntityPlugin() {
  useLexicalTextEntity(matchMention, MentionNode, createMention)
  return null
}

function SelectionHarness({
  nodeKey,
  command,
}: {
  nodeKey: NodeKey
  command?: LexicalCommand<undefined>
}) {
  const [ref, selected] = useSelectOrDelete(nodeKey, command)
  return (
    <div ref={ref} data-testid="block" data-selected={selected}>
      block
    </div>
  )
}

function TriggerHarness({ onBubble }: { onBubble: () => void }) {
  const [ref, open, setOpen] = useTrigger<HTMLButtonElement>()
  return (
    <div role="presentation" onClick={onBubble}>
      <button ref={ref} type="button">
        Toggle
      </button>
      <span>{open ? 'open' : 'closed'}</span>
      <button type="button" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  )
}

function renderEditor(makeNode: () => LexicalNode, command?: LexicalCommand<undefined>) {
  let editor: LexicalEditor
  let nodeKey: NodeKey
  const deleted = vi.fn(() => false)
  function Harness({ showHook }: { showHook: boolean }) {
    const [instance] = useLexicalComposerContext()
    editor = instance
    useEffect(
      () =>
        command ? instance.registerCommand(command, deleted, COMMAND_PRIORITY_LOW) : undefined,
      [instance],
    )
    return showHook ? <SelectionHarness nodeKey={nodeKey} command={command} /> : null
  }
  const initialConfig = {
    namespace: 'hooks-test',
    nodes: [ContextBlockNode, HistoryBlockNode, QueryBlockNode, CustomTextNode, MentionNode],
    onError: (error: Error) => {
      throw error
    },
    editorState: () => {
      const node = makeNode()
      nodeKey = node.getKey()
      $getRoot().append($createParagraphNode().append(node))
    },
  }
  const view = render(
    <LexicalComposer initialConfig={initialConfig}>
      <Harness showHook />
    </LexicalComposer>,
  )
  return {
    ...view,
    editor: editor!,
    nodeKey: nodeKey!,
    deleted,
    detachHook: () =>
      view.rerender(
        <LexicalComposer initialConfig={initialConfig}>
          <Harness showHook={false} />
        </LexicalComposer>,
      ),
  }
}

const blocks = [
  {
    name: 'context',
    makeNode: () => new ContextBlockNode([], vi.fn()),
    command: DELETE_CONTEXT_BLOCK_COMMAND,
  },
  {
    name: 'history',
    makeNode: () => new HistoryBlockNode({ user: 'Human', assistant: 'Assistant' }, vi.fn()),
    command: DELETE_HISTORY_BLOCK_COMMAND,
  },
  { name: 'query', makeNode: () => new QueryBlockNode(), command: DELETE_QUERY_BLOCK_COMMAND },
]

describe('prompt-editor/hooks', () => {
  describe('useSelectOrDelete', () => {
    it.each([KEY_DELETE_COMMAND, KEY_BACKSPACE_COMMAND])(
      'selects and deletes the real decorator for keyboard command %s',
      async (keyCommand) => {
        const user = userEvent.setup()
        const { editor, nodeKey, deleted } = renderEditor(
          () => new QueryBlockNode(),
          DELETE_QUERY_BLOCK_COMMAND,
        )
        await user.click(screen.getByTestId('block'))
        await waitFor(() =>
          expect(screen.getByTestId('block')).toHaveAttribute('data-selected', 'true'),
        )
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          expect($isNodeSelection(selection)).toBe(true)
          expect(selection?.getNodes().map((node) => node.getKey())).toEqual([nodeKey])
        })
        const event = new KeyboardEvent('keydown', { cancelable: true })
        act(() => {
          expect(editor.dispatchCommand(keyCommand, event)).toBe(true)
        })
        await waitFor(() =>
          expect(editor.getEditorState().read(() => $getNodeByKey(nodeKey))).toBeNull(),
        )
        expect(event.defaultPrevented).toBe(true)
        expect(deleted).toHaveBeenCalledTimes(1)
      },
    )

    it('deletes a selected decorator without an optional domain command', async () => {
      const user = userEvent.setup()
      const { editor, nodeKey } = renderEditor(() => new QueryBlockNode())
      await user.click(screen.getByTestId('block'))
      await waitFor(() =>
        expect(screen.getByTestId('block')).toHaveAttribute('data-selected', 'true'),
      )
      act(() => {
        editor.dispatchCommand(
          KEY_DELETE_COMMAND,
          new KeyboardEvent('keydown', { cancelable: true }),
        )
      })
      await waitFor(() =>
        expect(editor.getEditorState().read(() => $getNodeByKey(nodeKey))).toBeNull(),
      )
    })

    it.each(blocks)(
      'notifies the $name plugin when its block is covered by a range selection',
      ({ makeNode, command }) => {
        const { editor, nodeKey, deleted } = renderEditor(makeNode, command)
        act(() =>
          editor.update(
            () => {
              const paragraph = $getNodeByKey(nodeKey)!.getParentOrThrow()
              const selection = $createRangeSelection()
              selection.anchor.set(paragraph.getKey(), 0, 'element')
              selection.focus.set(paragraph.getKey(), 1, 'element')
              $setSelection(selection)
            },
            { discrete: true },
          ),
        )
        act(() => {
          expect(editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent('keydown'))).toBe(
            false,
          )
        })
        expect(deleted).toHaveBeenCalledTimes(1)
      },
    )

    it.each(['metaKey', 'ctrlKey'])('preserves selection for a modified click (%s)', (modifier) => {
      const { editor } = renderEditor(() => new QueryBlockNode())
      fireEvent.click(screen.getByTestId('block'), { [modifier]: true })
      expect(screen.getByTestId('block')).toHaveAttribute('data-selected', 'false')
      expect(editor.getEditorState().read(() => $getSelection())).toBeNull()
    })

    it('unregisters deletion when the hook is removed', async () => {
      const user = userEvent.setup()
      const { editor, nodeKey, deleted, detachHook } = renderEditor(
        () => new QueryBlockNode(),
        DELETE_QUERY_BLOCK_COMMAND,
      )
      await user.click(screen.getByTestId('block'))
      await waitFor(() =>
        expect(screen.getByTestId('block')).toHaveAttribute('data-selected', 'true'),
      )
      detachHook()
      act(() => {
        expect(editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent('keydown'))).toBe(false)
      })
      expect(editor.getEditorState().read(() => $getNodeByKey(nodeKey))).not.toBeNull()
      expect(deleted).not.toHaveBeenCalled()
    })
  })

  it('toggles and externally closes the popup without bubbling trigger clicks', async () => {
    const user = userEvent.setup()
    const onBubble = vi.fn()
    render(<TriggerHarness onBubble={onBubble} />)
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByText('open')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(onBubble).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('transforms matching text into an entity, restores plain text and removes transforms on unmount', () => {
    let editor: LexicalEditor
    function Capture() {
      ;[editor] = useLexicalComposerContext()
      return null
    }
    const config = {
      namespace: 'entities',
      nodes: [CustomTextNode, MentionNode],
      onError: (error: Error) => {
        throw error
      },
    }
    const { rerender } = render(
      <LexicalComposer initialConfig={config}>
        <Capture />
        <EntityPlugin />
      </LexicalComposer>,
    )
    act(() =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append(new CustomTextNode('@alice')))
        },
        { discrete: true },
      ),
    )
    const entityKey = editor!.getEditorState().read(() => {
      const node = $getRoot().getFirstDescendant()!
      expect(node).toBeInstanceOf(MentionNode)
      expect(node.getTextContent()).toBe('@alice')
      return node.getKey()
    })
    act(() =>
      editor.update(
        () => {
          const node = $getNodeByKey(entityKey)
          if (!$isTextNode(node)) throw new Error('Expected a text node')
          node.setTextContent('plain')
        },
        { discrete: true },
      ),
    )
    editor!.getEditorState().read(() => {
      expect($getRoot().getFirstDescendant()).toBeInstanceOf(TextNode)
      expect($getRoot().getFirstDescendant()).not.toBeInstanceOf(MentionNode)
      expect($getRoot().getTextContent()).toBe('plain')
    })
    rerender(
      <LexicalComposer initialConfig={config}>
        <Capture />
      </LexicalComposer>,
    )
    act(() =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append(new CustomTextNode('@bob')))
        },
        { discrete: true },
      ),
    )
    editor!
      .getEditorState()
      .read(() => expect($getRoot().getFirstDescendant()).toBeInstanceOf(CustomTextNode))
  })
  describe('useBasicTypeaheadTriggerMatch', () => {
    it('should return match details when input satisfies trigger and length rules', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('@', {
          minLength: 2,
          maxLength: 5,
        }),
      )

      const match = result.current('prefix @ab', createEditor())
      expect(match).toEqual({
        leadOffset: 7,
        matchingString: 'ab',
        replaceableString: '@ab',
      })
    })

    it('should return null when matching text is shorter than minLength', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('@', {
          minLength: 2,
          maxLength: 5,
        }),
      )

      expect(result.current('prefix @a', createEditor())).toBeNull()
    })

    it('should return null when matching text exceeds maxLength', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('@', {
          minLength: 1,
          maxLength: 2,
        }),
      )
      expect(result.current('prefix @abc', createEditor())).toBeNull()
    })

    it('should return null when text has no trigger character', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('@', {
          minLength: 1,
          maxLength: 75,
        }),
      )
      expect(result.current('no trigger here', createEditor())).toBeNull()
    })

    it('should match a trigger at the start of the text', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('/', {
          minLength: 0,
          maxLength: 75,
          requireTriggerBoundary: true,
        }),
      )

      expect(result.current('/query', createEditor())).toEqual({
        leadOffset: 0,
        matchingString: 'query',
        replaceableString: '/query',
      })
    })

    it('should match a trigger preceded by whitespace', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('/', {
          minLength: 0,
          maxLength: 75,
          requireTriggerBoundary: true,
        }),
      )

      expect(result.current('prefix /query', createEditor())).toEqual({
        leadOffset: 7,
        matchingString: 'query',
        replaceableString: '/query',
      })
    })

    it.each(['https://dict.youdao.com/dictvoice', 'path/to/file'])(
      'should not match a trigger preceded by a non-whitespace character in %s',
      (text) => {
        const { result } = renderHook(() =>
          useBasicTypeaheadTriggerMatch('/', {
            minLength: 0,
            maxLength: 75,
            requireTriggerBoundary: true,
          }),
        )

        expect(result.current(text, createEditor())).toBeNull()
      },
    )

    it('should preserve triggers without a required boundary', () => {
      const { result } = renderHook(() =>
        useBasicTypeaheadTriggerMatch('{', {
          minLength: 0,
          maxLength: 75,
        }),
      )

      expect(result.current('prefix{query', createEditor())).toEqual({
        leadOffset: 6,
        matchingString: 'query',
        replaceableString: '{query',
      })
    })
  })
})
