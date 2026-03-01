import type {
  Klass,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
  TextNode,
} from 'lexical'
import type { CustomTextNode } from './plugins/custom-text/node'
import type { MenuTextMatch } from './types'
import {
  $splitNodeContainingQuery,
  decoratorTransform,
  getSelectedNode,
  registerLexicalTextEntity,
  textToEditorState,
} from './utils'

const mockState = vi.hoisted(() => ({
  isAtNodeEnd: false,
  selection: null as unknown,
  createTextNode: vi.fn(),
}))

vi.mock('@lexical/selection', () => ({
  $isAtNodeEnd: () => mockState.isAtNodeEnd,
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $getSelection: () => mockState.selection,
    $isRangeSelection: (selection: unknown) => !!(selection as { __isRangeSelection?: boolean } | null)?.__isRangeSelection,
    $createTextNode: mockState.createTextNode,
    $isTextNode: (node: unknown) => !!(node as { __isTextNode?: boolean } | null)?.__isTextNode,
  }
})

vi.mock('./plugins/custom-text/node', () => ({
  CustomTextNode: class MockCustomTextNode {},
}))

describe('prompt-editor/utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isAtNodeEnd = false
    mockState.selection = null
  })

  // Node selection utility for forward/backward lexical cursor behavior.
  describe('getSelectedNode', () => {
    it('should return anchor node when anchor and focus are the same node', () => {
      const sharedNode = { id: 'same' }
      const selection = {
        anchor: { getNode: () => sharedNode },
        focus: { getNode: () => sharedNode },
        isBackward: () => false,
      } as unknown as RangeSelection

      expect(getSelectedNode(selection)).toBe(sharedNode)
    })

    it('should return anchor node for backward selection when focus is at node end', () => {
      const anchorNode = { id: 'anchor' }
      const focusNode = { id: 'focus' }
      const selection = {
        anchor: { getNode: () => anchorNode },
        focus: { getNode: () => focusNode },
        isBackward: () => true,
      } as unknown as RangeSelection

      mockState.isAtNodeEnd = true
      expect(getSelectedNode(selection)).toBe(anchorNode)
    })

    it('should return focus node for forward selection when anchor is not at node end', () => {
      const anchorNode = { id: 'anchor' }
      const focusNode = { id: 'focus' }
      const selection = {
        anchor: { getNode: () => anchorNode },
        focus: { getNode: () => focusNode },
        isBackward: () => false,
      } as unknown as RangeSelection

      mockState.isAtNodeEnd = false
      expect(getSelectedNode(selection)).toBe(focusNode)
    })
  })

  // Entity registration should register transforms and convert invalid entity nodes.
  describe('registerLexicalTextEntity', () => {
    it('should register transforms and replace invalid target node with plain text', () => {
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => 'invalid')
        getFormat = vi.fn(() => 9)
        replace = vi.fn()
        splitText = vi.fn()
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }

      const removePlainTextTransform = vi.fn()
      const removeReverseNodeTransform = vi.fn()
      const registerNodeTransform = vi
        .fn()
        .mockReturnValueOnce(removePlainTextTransform)
        .mockReturnValueOnce(removeReverseNodeTransform)
      const editor = {
        registerNodeTransform,
      } as unknown as LexicalEditor
      const createdTextNode = {
        setFormat: vi.fn(),
      }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      const getMatch = vi.fn(() => null)
      type TargetTextNode = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TargetTextNode>
      const createNode = vi.fn((textNode: TextNode) => textNode as TargetTextNode)

      const cleanups = registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      expect(cleanups).toEqual([removePlainTextTransform, removeReverseNodeTransform])

      const reverseNodeTransform = registerNodeTransform.mock.calls[1][1] as (node: TargetTextNode) => void
      const targetNode = new TargetNode() as TargetTextNode
      reverseNodeTransform(targetNode)

      expect(mockState.createTextNode).toHaveBeenCalledWith('invalid')
      expect(createdTextNode.setFormat).toHaveBeenCalledWith(9)
      expect(targetNode.replace).toHaveBeenCalledWith(createdTextNode)
    })
  })

  // Decorator transform behavior for converting matched text segments.
  describe('decoratorTransform', () => {
    it('should do nothing when node is not simple text', () => {
      const node = {
        isSimpleText: vi.fn(() => false),
      } as unknown as CustomTextNode
      const getMatch = vi.fn()
      const createNode = vi.fn()

      decoratorTransform(node, getMatch, createNode)

      expect(getMatch).not.toHaveBeenCalled()
      expect(createNode).not.toHaveBeenCalled()
    })

    it('should replace matched text node segment with created decorator node', () => {
      const replacedNode = { replace: vi.fn() }
      const node = {
        __isTextNode: true,
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => null),
        getTextContent: vi.fn(() => 'abc'),
        getNextSibling: vi.fn(() => null),
        splitText: vi.fn(() => [replacedNode, null]),
      } as unknown as CustomTextNode
      const getMatch = vi
        .fn()
        .mockReturnValueOnce({ start: 0, end: 1 })
        .mockReturnValueOnce(null)
      const createdDecoratorNode = { id: 'decorator' }
      const createNode = vi.fn(() => createdDecoratorNode as unknown as LexicalNode)

      decoratorTransform(node, getMatch, createNode)

      expect(node.splitText).toHaveBeenCalledWith(1)
      expect(createNode).toHaveBeenCalledWith(replacedNode)
      expect(replacedNode.replace).toHaveBeenCalledWith(createdDecoratorNode)
    })
  })

  // Split helper for menu query replacement inside collapsed text selection.
  describe('$splitNodeContainingQuery', () => {
    const match: MenuTextMatch = {
      leadOffset: 0,
      matchingString: 'abc',
      replaceableString: '@abc',
    }

    it('should return null when selection is not a collapsed range selection', () => {
      mockState.selection = { __isRangeSelection: false }
      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should return null when anchor is not text selection', () => {
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: {
          type: 'element',
          offset: 1,
          getNode: vi.fn(),
        },
      }

      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should split using single offset when query starts at beginning of text', () => {
      const newNode = { id: 'new-node' }
      const anchorNode = {
        isSimpleText: () => true,
        getTextContent: () => '@abc',
        splitText: vi.fn(() => [newNode]),
      }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: {
          type: 'text',
          offset: 4,
          getNode: () => anchorNode,
        },
      }

      const result = $splitNodeContainingQuery(match)

      expect(anchorNode.splitText).toHaveBeenCalledWith(4)
      expect(result).toBe(newNode)
    })

    it('should split using range offsets when query is inside text', () => {
      const newNode = { id: 'new-node' }
      const anchorNode = {
        isSimpleText: () => true,
        getTextContent: () => 'hello @abc',
        splitText: vi.fn(() => [null, newNode]),
      }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: {
          type: 'text',
          offset: 10,
          getNode: () => anchorNode,
        },
      }

      const result = $splitNodeContainingQuery(match)

      expect(anchorNode.splitText).toHaveBeenCalledWith(6, 10)
      expect(result).toBe(newNode)
    })
  })

  // Serialization utility for prompt text -> lexical editor state JSON.
  describe('textToEditorState', () => {
    it('should serialize multiline text into paragraph nodes', () => {
      const state = JSON.parse(textToEditorState('line-1\nline-2'))

      expect(state.root.children).toHaveLength(2)
      expect(state.root.children[0].children[0].text).toBe('line-1')
      expect(state.root.children[1].children[0].text).toBe('line-2')
      expect(state.root.type).toBe('root')
    })

    it('should create one empty paragraph when text is empty', () => {
      const state = JSON.parse(textToEditorState(''))

      expect(state.root.children).toHaveLength(1)
      expect(state.root.children[0].children[0].text).toBe('')
    })
  })
})
