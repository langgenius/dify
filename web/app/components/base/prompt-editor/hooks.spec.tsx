import type { EntityMatch } from '@lexical/text'
import type { Klass, LexicalEditor, TextNode } from 'lexical'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { COMMAND_PRIORITY_LOW, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND } from 'lexical'
import {
  useBasicTypeaheadTriggerMatch,
  useLexicalTextEntity,
  useSelectOrDelete,
  useTrigger,
} from './hooks'
import {
  DELETE_CONTEXT_BLOCK_COMMAND,
} from './plugins/context-block'
import { ContextBlockNode } from './plugins/context-block/node'
import { DELETE_QUERY_BLOCK_COMMAND } from './plugins/query-block'
import { QueryBlockNode } from './plugins/query-block/node'

type MockNode = {
  isDecorator?: boolean
  remove?: () => void
}

type MockSelection = {
  getNodes: () => MockNode[]
  isNodeSelection?: boolean
}

type SelectOrDeleteCommand = Parameters<typeof useSelectOrDelete>[1]
type LexicalTextEntityGetMatch = (text: string) => null | EntityMatch
type LexicalTextEntityCreateNode = (textNode: TextNode) => TextNode

const mockState = vi.hoisted(() => {
  const commandHandlers = new Map<unknown, (event: KeyboardEvent) => boolean>()
  const registerCommand = vi.fn((command: unknown, handler: (event: KeyboardEvent) => boolean) => {
    commandHandlers.set(command, handler)
    return vi.fn()
  })

  return {
    editor: {
      registerCommand,
      registerNodeTransform: vi.fn(),
      dispatchCommand: vi.fn(),
    },
    commandHandlers,
    isSelected: false,
    setSelected: vi.fn(),
    clearSelection: vi.fn(),
    selection: null as MockSelection | null,
    node: null as MockNode | null,
    mergeRegister: vi.fn((...cleanups: Array<() => void>) => {
      return () => {
        cleanups.forEach(cleanup => cleanup())
      }
    }),
    removePlainTextTransform: vi.fn(),
    removeReverseNodeTransform: vi.fn(),
  }
})

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockState.editor],
}))

vi.mock('@lexical/react/useLexicalNodeSelection', () => ({
  useLexicalNodeSelection: () => [
    mockState.isSelected,
    mockState.setSelected,
    mockState.clearSelection,
  ],
}))

vi.mock('@lexical/utils', () => ({
  mergeRegister: mockState.mergeRegister,
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $getSelection: () => mockState.selection,
    $getNodeByKey: () => mockState.node,
    $isDecoratorNode: (node: MockNode | null) => !!node?.isDecorator,
    $isNodeSelection: (selection: MockSelection | null) => !!selection?.isNodeSelection,
  }
})

const SelectOrDeleteHarness = ({ nodeKey, command }: {
  nodeKey: string
  command?: SelectOrDeleteCommand
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, command)
  return (
    <div
      ref={ref}
      data-testid="select-or-delete-node"
      data-selected={isSelected ? 'true' : 'false'}
    >
      node
    </div>
  )
}

const TriggerHarness = () => {
  const [ref, open] = useTrigger()
  return (
    <div>
      <div ref={ref} data-testid="trigger-target">toggle</div>
      <span>{open ? 'open' : 'closed'}</span>
    </div>
  )
}

const LexicalTextEntityHarness = ({
  getMatch,
  targetNode,
  createNode,
}: {
  getMatch: LexicalTextEntityGetMatch
  targetNode: Klass<TextNode>
  createNode: LexicalTextEntityCreateNode
}) => {
  useLexicalTextEntity(getMatch, targetNode, createNode)
  return null
}

describe('prompt-editor/hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.commandHandlers.clear()
    mockState.isSelected = false
    mockState.selection = null
    mockState.node = null
    mockState.editor.registerNodeTransform
      .mockReset()
      .mockReturnValueOnce(mockState.removePlainTextTransform)
      .mockReturnValueOnce(mockState.removeReverseNodeTransform)
  })

  // Selection/deletion hook behavior around Lexical node commands.
  describe('useSelectOrDelete', () => {
    it('should register delete and backspace commands and select node on click', async () => {
      const user = userEvent.setup()
      render(
        <SelectOrDeleteHarness
          nodeKey="node-1"
          command={DELETE_CONTEXT_BLOCK_COMMAND}
        />,
      )

      expect(mockState.editor.registerCommand).toHaveBeenCalledWith(
        KEY_DELETE_COMMAND,
        expect.any(Function),
        COMMAND_PRIORITY_LOW,
      )
      expect(mockState.editor.registerCommand).toHaveBeenCalledWith(
        KEY_BACKSPACE_COMMAND,
        expect.any(Function),
        COMMAND_PRIORITY_LOW,
      )

      await user.click(screen.getByTestId('select-or-delete-node'))

      expect(mockState.clearSelection).toHaveBeenCalled()
      expect(mockState.setSelected).toHaveBeenCalledWith(true)
    })

    it('should dispatch delete command when unselected context block is focused', () => {
      mockState.isSelected = false
      mockState.selection = {
        getNodes: () => [Object.create(ContextBlockNode.prototype) as MockNode],
        isNodeSelection: false,
      }

      render(
        <SelectOrDeleteHarness
          nodeKey="node-1"
          command={DELETE_CONTEXT_BLOCK_COMMAND}
        />,
      )

      const deleteHandler = mockState.commandHandlers.get(KEY_DELETE_COMMAND)
      expect(deleteHandler).toBeDefined()

      const handled = deleteHandler?.(new KeyboardEvent('keydown'))

      expect(handled).toBe(false)
      expect(mockState.editor.dispatchCommand).toHaveBeenCalledWith(DELETE_CONTEXT_BLOCK_COMMAND, undefined)
    })

    it('should prevent default and remove selected decorator node on delete', () => {
      const remove = vi.fn()
      const preventDefault = vi.fn()
      mockState.isSelected = true
      mockState.selection = {
        getNodes: () => [Object.create(QueryBlockNode.prototype) as MockNode],
        isNodeSelection: true,
      }
      mockState.node = {
        isDecorator: true,
        remove,
      }

      render(
        <SelectOrDeleteHarness
          nodeKey="node-1"
          command={DELETE_QUERY_BLOCK_COMMAND}
        />,
      )

      const backspaceHandler = mockState.commandHandlers.get(KEY_BACKSPACE_COMMAND)
      expect(backspaceHandler).toBeDefined()

      const handled = backspaceHandler?.({ preventDefault } as unknown as KeyboardEvent)

      expect(handled).toBe(true)
      expect(preventDefault).toHaveBeenCalled()
      expect(mockState.editor.dispatchCommand).toHaveBeenCalledWith(DELETE_QUERY_BLOCK_COMMAND, undefined)
      expect(remove).toHaveBeenCalled()
    })
  })

  // Trigger hook toggles dropdown/popup state from bound DOM element.
  describe('useTrigger', () => {
    it('should toggle open state when trigger element is clicked', async () => {
      const user = userEvent.setup()
      render(<TriggerHarness />)

      expect(screen.getByText('closed')).toBeInTheDocument()

      await user.click(screen.getByTestId('trigger-target'))
      expect(screen.getByText('open')).toBeInTheDocument()

      await user.click(screen.getByTestId('trigger-target'))
      expect(screen.getByText('closed')).toBeInTheDocument()
    })
  })

  // Lexical entity hook should register and cleanup transforms.
  describe('useLexicalTextEntity', () => {
    it('should register lexical text entity transforms and cleanup on unmount', () => {
      class MockTargetNode {}
      const getMatch: LexicalTextEntityGetMatch = vi.fn(() => null)
      const createNode: LexicalTextEntityCreateNode = vi.fn((textNode: TextNode) => textNode)

      const { unmount } = render(
        <LexicalTextEntityHarness
          getMatch={getMatch}
          targetNode={MockTargetNode as unknown as Klass<TextNode>}
          createNode={createNode}
        />,
      )

      expect(mockState.editor.registerNodeTransform).toHaveBeenCalledTimes(2)
      // Verify the first call uses TextNode, not MockTargetNode
      const calls = mockState.editor.registerNodeTransform.mock.calls
      expect(calls[0][0]).not.toBe(MockTargetNode)
      expect(typeof calls[0][0]).toBe('function')
      expect(mockState.editor.registerNodeTransform).toHaveBeenCalledWith(
        MockTargetNode,
        expect.any(Function),
      )

      unmount()

      expect(getMatch).not.toHaveBeenCalled()
      expect(createNode).not.toHaveBeenCalled()
      expect(mockState.removePlainTextTransform).toHaveBeenCalled()
      expect(mockState.removeReverseNodeTransform).toHaveBeenCalled()
    })
  })

  // Regex trigger matcher behavior for typeahead text detection.
  describe('useBasicTypeaheadTriggerMatch', () => {
    it('should return match details when input satisfies trigger and length rules', () => {
      const { result } = renderHook(() => useBasicTypeaheadTriggerMatch('@', {
        minLength: 2,
        maxLength: 5,
      }))

      const match = result.current('prefix @..', {} as LexicalEditor)
      expect(match).toEqual({
        leadOffset: 7,
        matchingString: '..',
        replaceableString: '@..',
      })
    })

    it('should return null when matching text is shorter than minLength', () => {
      const { result } = renderHook(() => useBasicTypeaheadTriggerMatch('@', {
        minLength: 2,
        maxLength: 5,
      }))

      expect(result.current('prefix @.', {} as LexicalEditor)).toBeNull()
    })

    it('should return null when matching text exceeds maxLength', () => {
      const { result } = renderHook(() => useBasicTypeaheadTriggerMatch('@', {
        minLength: 1,
        maxLength: 2,
      }))
      expect(result.current('prefix @...', {} as LexicalEditor)).toBeNull()
    })
  })
})
