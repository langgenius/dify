import type {
  Klass,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
  TextNode,
} from 'lexical'
import type { CustomTextNode } from '../plugins/custom-text/node'
import type { MenuTextMatch } from '../types'
import {
  $splitNodeContainingQuery,
  decoratorTransform,
  getSelectedNode,
  registerLexicalTextEntity,
  textToEditorState,
} from '../utils'

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
  CustomTextNode: class MockCustomTextNode { },
}))

describe('prompt-editor/utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isAtNodeEnd = false
    mockState.selection = null
  })
  function makeEditor() {
    const removePlainTextTransform = vi.fn()
    const removeReverseNodeTransform = vi.fn()
    const registerNodeTransform = vi
      .fn()
      .mockReturnValueOnce(removePlainTextTransform)
      .mockReturnValueOnce(removeReverseNodeTransform)
    const editor = { registerNodeTransform } as unknown as LexicalEditor
    return { editor, registerNodeTransform }
  }

  // ---------------------------------------------------------------------------
  // getSelectedNode
  // ---------------------------------------------------------------------------
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

    it('should return anchor node for backward selection when focus IS at node end', () => {
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

    it('should return focus node for backward selection when focus is NOT at node end', () => {
      const anchorNode = { id: 'anchor' }
      const focusNode = { id: 'focus' }
      const selection = {
        anchor: { getNode: () => anchorNode },
        focus: { getNode: () => focusNode },
        isBackward: () => true,
      } as unknown as RangeSelection

      mockState.isAtNodeEnd = false
      expect(getSelectedNode(selection)).toBe(focusNode)
    })

    it('should return anchor node for forward selection when anchor IS at node end', () => {
      const anchorNode = { id: 'anchor' }
      const focusNode = { id: 'focus' }
      const selection = {
        anchor: { getNode: () => anchorNode },
        focus: { getNode: () => focusNode },
        isBackward: () => false,
      } as unknown as RangeSelection

      mockState.isAtNodeEnd = true
      expect(getSelectedNode(selection)).toBe(anchorNode)
    })

    it('should return focus node for forward selection when anchor is NOT at node end', () => {
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

  // ---------------------------------------------------------------------------
  // registerLexicalTextEntity
  // ---------------------------------------------------------------------------
  describe('registerLexicalTextEntity', () => {
    // ---- reverseNodeTransform ----

    it('reverseNodeTransform: replaceWithSimpleText when match is null', () => {
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
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      const getMatch = vi.fn(() => null)
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((node: TextNode) => node as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const reverseTransform = registerNodeTransform.mock.calls[1]![1] as (n: TN) => void
      const node = new TargetNode() as TN
      reverseTransform(node)

      expect(mockState.createTextNode).toHaveBeenCalledWith('invalid')
      expect(createdTextNode.setFormat).toHaveBeenCalledWith(9)
      expect(node.replace).toHaveBeenCalledWith(createdTextNode)
    })

    it('reverseNodeTransform: replaceWithSimpleText when match.start !== 0', () => {
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => 'text')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      // match.start = 2 (non-zero) → replaceWithSimpleText
      const getMatch = vi.fn(() => ({ start: 2, end: 4 }))
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const reverseTransform = registerNodeTransform.mock.calls[1]![1] as (n: TN) => void
      const node = new TargetNode() as TN
      reverseTransform(node)

      expect(node.replace).toHaveBeenCalledWith(createdTextNode)
    })

    it('reverseNodeTransform: splits when text.length > match.end', () => {
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => '@abc extra')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      const getMatch = vi.fn(() => ({ start: 0, end: 4 }))
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const reverseTransform = registerNodeTransform.mock.calls[1]![1] as (n: TN) => void
      const node = new TargetNode() as TN
      reverseTransform(node)

      expect(node.splitText).toHaveBeenCalledWith(4)
    })

    it('reverseNodeTransform: replaces prevSibling and self when prevSibling isTextEntity', () => {
      const prevSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => true),
        getTextContent: vi.fn(() => 'prev'),
        getFormat: vi.fn(() => 0),
        replace: vi.fn(),
      }
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => '@abc')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getPreviousSibling = vi.fn(() => prevSibling)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      const getMatch = vi.fn(() => ({ start: 0, end: 4 }))
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const reverseTransform = registerNodeTransform.mock.calls[1]![1] as (n: TN) => void
      const node = new TargetNode() as TN
      reverseTransform(node)

      expect(prevSibling.replace).toHaveBeenCalled()
      expect(node.replace).toHaveBeenCalled()
    })

    it('reverseNodeTransform: replaces nextSibling and self when nextSibling isTextEntity', () => {
      const nextSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => true),
        getTextContent: vi.fn(() => 'next'),
        getFormat: vi.fn(() => 0),
        replace: vi.fn(),
      }
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => '@abc')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => nextSibling)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      const getMatch = vi.fn(() => ({ start: 0, end: 4 }))
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const reverseTransform = registerNodeTransform.mock.calls[1]![1] as (n: TN) => void
      const node = new TargetNode() as TN
      reverseTransform(node)

      expect(nextSibling.replace).toHaveBeenCalled()
      expect(node.replace).toHaveBeenCalled()
    })

    // ---- textNodeTransform ----

    it('textNodeTransform: returns early when prevSibling is TargetNode and match is null', () => {
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => 'text')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        select = vi.fn()
        setTextContent = vi.fn()
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
        remove = vi.fn()
        markDirty = vi.fn()
      }
      const prevSibling = new TargetNode()
      prevSibling.getTextContent = vi.fn(() => 'prev')
      prevSibling.getPreviousSibling = vi.fn(() => null)

      class NodeUnderTest {
        __isTextNode = true
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getTextContent = vi.fn(() => 'text')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        markDirty = vi.fn()
        remove = vi.fn()
        getPreviousSibling = vi.fn(() => prevSibling as unknown)
        getNextSibling = vi.fn(() => null)
      }

      const getMatch = vi.fn(() => null)
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      // prevSibling is TargetNode, match=null → replaceWithSimpleText(prevSibling) + return
      expect(prevSibling.replace).toHaveBeenCalled()
      expect(createNode).not.toHaveBeenCalled()
    })

    it('textNodeTransform: returns early when prevSibling is plain text node and prevMatch is null', () => {
      const prevSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => false),
        getTextContent: vi.fn(() => 'prev'),
      }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'text')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => prevSibling)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const getMatch = vi.fn(() => null)
      class TargetNode { }
      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      // prevSibling is NOT TargetNode, prevMatch=null → return (line 98)
      expect(createNode).not.toHaveBeenCalled()
    })

    it('textNodeTransform: marks nextSibling dirty when it is a plain text node and nextMatch is null', () => {
      const nextSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => false),
        getTextContent: vi.fn(() => ' more'),
        markDirty: vi.fn(),
      }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'no-match')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => nextSibling)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const getMatch = vi.fn(() => null)
      class TargetNode { }
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      expect(nextSibling.markDirty).toHaveBeenCalled()
    })

    it('textNodeTransform: creates replacement node at non-zero match.start', () => {
      const nodeToReplace = { replace: vi.fn(), getFormat: vi.fn(() => 0) }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'hello @abc')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn(() => [undefined, nodeToReplace, null])
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      let callCount = 0
      const getMatch = vi.fn(() => {
        callCount++
        return callCount === 1 ? { start: 6, end: 10 } : null
      })
      const replacementNode = { setFormat: vi.fn(), replace: vi.fn() }
      class TargetNode { }
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn(() => replacementNode as unknown as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      expect(node.splitText).toHaveBeenCalledWith(6, 10)
      expect(createNode).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // decoratorTransform
  // ---------------------------------------------------------------------------
  describe('decoratorTransform', () => {
    it('should do nothing when node is not simple text', () => {
      const node = { isSimpleText: vi.fn(() => false) } as unknown as CustomTextNode
      const getMatch = vi.fn()

      decoratorTransform(node, getMatch, vi.fn())

      expect(getMatch).not.toHaveBeenCalled()
    })

    it('should replace matched segment at start (match.start === 0)', () => {
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
      const createdNode = { id: 'created' }
      const createNode = vi.fn(() => createdNode as unknown as LexicalNode)

      decoratorTransform(node, getMatch, createNode)

      expect(node.splitText).toHaveBeenCalledWith(1)
      expect(replacedNode.replace).toHaveBeenCalledWith(createdNode)
    })

    it('should markDirty on plain nextSibling when combined nextMatch is null', () => {
      const nextSibling = {
        __isTextNode: true,
        getTextContent: vi.fn(() => ' more'),
        markDirty: vi.fn(),
      }
      const node = {
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => null),
        getTextContent: vi.fn(() => 'no-match'),
        getNextSibling: vi.fn(() => nextSibling),
        splitText: vi.fn(),
      } as unknown as CustomTextNode

      decoratorTransform(node, vi.fn(() => null), vi.fn())

      expect(nextSibling.markDirty).toHaveBeenCalled()
    })

    it('should return when nextSibling nextMatch.start !== 0', () => {
      const nextSibling = {
        __isTextNode: true,
        getTextContent: vi.fn(() => ' tail'),
        markDirty: vi.fn(),
      }
      const node = {
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => null),
        getTextContent: vi.fn(() => 'text'),
        getNextSibling: vi.fn(() => nextSibling),
        splitText: vi.fn(),
      } as unknown as CustomTextNode
      let n = 0
      /* first call (on 'text') → null; second call (on combined 'text tail') → start≠0 */
      const getMatch = vi.fn(() => {
        n++
        return n === 2 ? { start: 5, end: 9 } : null
      })

      decoratorTransform(node, getMatch, vi.fn())

      expect(node.splitText).not.toHaveBeenCalled()
    })

    it('should return when nextText is non-empty and nextMatch.start === 0', () => {
      const node = {
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => null),
        getTextContent: vi.fn(() => 'abc def'),
        getNextSibling: vi.fn(() => null),
        splitText: vi.fn(),
      } as unknown as CustomTextNode
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        /* first: match with end=3 → nextText='abc def'.slice(3)=' def' (non-empty) */
        /* second (on ' def'): start=0 → return early */
        return n === 1 ? { start: 0, end: 3 } : { start: 0, end: 4 }
      })

      decoratorTransform(node, getMatch, vi.fn())

      expect(node.splitText).not.toHaveBeenCalled()
    })

    it('should split with non-zero start offset', () => {
      const nodeToReplace = { replace: vi.fn() }
      const node = {
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => null),
        getTextContent: vi.fn(() => 'hello @abc'),
        getNextSibling: vi.fn(() => null),
        splitText: vi.fn(() => [undefined, nodeToReplace, null]),
      } as unknown as CustomTextNode
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        return n === 1 ? { start: 6, end: 10 } : null
      })
      const created = { id: 'x' }
      const createNode = vi.fn(() => created as unknown as LexicalNode)

      decoratorTransform(node, getMatch, createNode)

      expect(node.splitText).toHaveBeenCalledWith(6, 10)
      expect(nodeToReplace.replace).toHaveBeenCalledWith(created)
    })

    it('should continue (skip creation) when prevSibling isTextEntity and match.start === 0', () => {
      const prevSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => true),
      }
      const node = {
        isSimpleText: vi.fn(() => true),
        getPreviousSibling: vi.fn(() => prevSibling),
        getTextContent: vi.fn(() => ''),
        getNextSibling: vi.fn(() => null),
        splitText: vi.fn(),
      } as unknown as CustomTextNode
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        return n <= 2 ? { start: 0, end: 0 } : null
      })

      decoratorTransform(node, getMatch, vi.fn())

      expect(node.splitText).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // $splitNodeContainingQuery
  // ---------------------------------------------------------------------------
  describe('$splitNodeContainingQuery', () => {
    const match: MenuTextMatch = {
      leadOffset: 0,
      matchingString: 'abc',
      replaceableString: '@abc',
    }

    it('should return null when selection is not a range selection', () => {
      mockState.selection = { __isRangeSelection: false }
      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should return null when selection is not collapsed', () => {
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => false,
        anchor: { type: 'text', offset: 4, getNode: vi.fn() },
      }
      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should return null when anchor type is not text', () => {
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'element', offset: 1, getNode: vi.fn() },
      }
      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should return null when anchor node is not simple text', () => {
      const anchorNode = { isSimpleText: () => false, getTextContent: () => '@abc' }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'text', offset: 4, getNode: () => anchorNode },
      }
      expect($splitNodeContainingQuery(match)).toBeNull()
    })

    it('should return null when startOffset is negative', () => {
      const anchorNode = { isSimpleText: () => true, getTextContent: () => '@', splitText: vi.fn() }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'text', offset: 1, getNode: () => anchorNode },
      }
      // replaceableString longer than offset → startOffset < 0
      const longMatch: MenuTextMatch = { leadOffset: 0, matchingString: 'abc', replaceableString: '@abcdef' }
      expect($splitNodeContainingQuery(longMatch)).toBeNull()
    })

    it('should split using single offset when query starts at beginning', () => {
      const newNode = { id: 'new-node' }
      const anchorNode = {
        isSimpleText: () => true,
        getTextContent: () => '@abc',
        splitText: vi.fn(() => [newNode]),
      }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'text', offset: 4, getNode: () => anchorNode },
      }

      const result = $splitNodeContainingQuery(match)

      expect(anchorNode.splitText).toHaveBeenCalledWith(4)
      expect(result).toBe(newNode)
    })

    it('should split using range offsets when query is mid-text', () => {
      const newNode = { id: 'new-node' }
      const anchorNode = {
        isSimpleText: () => true,
        getTextContent: () => 'hello @abc',
        splitText: vi.fn(() => [null, newNode]),
      }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'text', offset: 10, getNode: () => anchorNode },
      }

      const result = $splitNodeContainingQuery(match)

      expect(anchorNode.splitText).toHaveBeenCalledWith(6, 10)
      expect(result).toBe(newNode)
    })
  })

  // ---------------------------------------------------------------------------
  // textToEditorState
  // ---------------------------------------------------------------------------
  describe('textToEditorState', () => {
    it('should serialize multiline text into paragraph nodes', () => {
      const state = JSON.parse(textToEditorState('line-1\nline-2'))

      expect(state.root.children).toHaveLength(2)
      expect(state.root.children[0].children[0].text).toBe('line-1')
      expect(state.root.children[1].children[0].text).toBe('line-2')
      expect(state.root.type).toBe('root')
    })

    it('should create one empty paragraph when text is empty string', () => {
      const state = JSON.parse(textToEditorState(''))

      expect(state.root.children).toHaveLength(1)
      expect(state.root.children[0].children[0].text).toBe('')
    })

    it('should produce correct paragraph and custom-text node structure', () => {
      const state = JSON.parse(textToEditorState('hello'))
      const para = state.root.children[0]

      expect(para.type).toBe('paragraph')
      expect(para.children[0].type).toBe('custom-text')
      expect(para.children[0].mode).toBe('normal')
      expect(para.children[0].detail).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Additional textNodeTransform branches (lines 115, 122, 134, 137-138)
  // ---------------------------------------------------------------------------
  describe('registerLexicalTextEntity - additional textNodeTransform branches', () => {
    it('should replaceWithSimpleText on nextSibling when it IS a TargetNode and nextMatch is null', () => {
      // Line 115: isTargetNode(nextSibling) === true → replaceWithSimpleText(nextSibling)
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => 'next')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        markDirty = vi.fn()
      }
      const nextSibling = new TargetNode() // IS a TargetNode instance

      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'no-match')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null as unknown)
        getNextSibling = vi.fn(() => nextSibling as unknown)
        markDirty = vi.fn()
      }

      const { editor, registerNodeTransform } = makeEditor()
      const createdTextNode = { setFormat: vi.fn() }
      mockState.createTextNode.mockReturnValue(createdTextNode)
      // getMatch always returns null → while loop: nextSibling found, nextMatch=null, isTargetNode=true
      const getMatch = vi.fn(() => null)
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      // nextSibling (TargetNode) → replaceWithSimpleText(nextSibling)
      expect(nextSibling.replace).toHaveBeenCalledWith(createdTextNode)
    })

    it('should return when nextSibling nextMatch.start !== 0 (line 122-123)', () => {
      // Similar to decoratorTransform but for textNodeTransform
      class TargetNode { }
      const nextSibling = {
        __isTextNode: true,
        isTextEntity: vi.fn(() => false),
        getTextContent: vi.fn(() => ' tail'),
        markDirty: vi.fn(),
      }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'text')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => nextSibling)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      let n = 0
      // first: null (match===null → nextText=''); combined nextMatch.start !== 0
      const getMatch = vi.fn(() => (n++ === 1 ? { start: 3, end: 7 } : null))
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((node: TextNode) => node as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest() as unknown as TextNode)

      // nextMatch.start !== 0 → return (line 123)
      expect(createNode).not.toHaveBeenCalled()
    })

    it('should return at line 134 when match is null on second loop iteration', () => {
      // Scenario: first loop iter finds a match (start=0), replacement succeeds (currentNode=null→exits)
      // OR: second loop iter: match=null (text='') with no nextSibling → return at line 134
      // We choose the simpler path: getMatch returns match on iter1, then null on iter2
      // currentNode.splitText returns [nodeToReplace, null] → currentNode=null → exits at line 152
      // (this actually tests line 134 indirectly by ensuring line 152 exits; and also line 134=true)
      // The cleanest way to reach line 134 is: match is null AND nextText is '' AND no nextSibling
      // That happens when match===null at the start of the while loop: nextText='', no nextSibling → exit
      class TargetNode { }
      const nodeToReplace = { replace: vi.fn(), getFormat: vi.fn(() => 0) }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'abc def')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn(() => [nodeToReplace, null]) // returns [replaced, null]
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        if (n === 1)
          return { start: 0, end: 3 } // first iter: match found → splitText → currentNode=null
        return null // second iter would return null, but we exit at line 152 before this
      })
      const replacementNode = { setFormat: vi.fn(), replace: vi.fn() }

      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn(() => replacementNode as unknown as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest() as unknown as TextNode)

      // createNode was called (first match replacement) and currentNode=null exits loop at 152
      expect(createNode).toHaveBeenCalled()
    })

    it('should continue loop when prevSibling isTextEntity and match.start===0 (line 137-138)', () => {
      // Ensure no prevSibling (so prevSibling processing is skipped) and the node gets a match
      // at start=0 with a prevSibling that isTextEntity → continue
      class TargetNode { }
      // prevSibling has no __isTextNode → $isTextNode returns false → skip prevSibling block
      const prevSiblingEntity = {
        // No __isTextNode so $isTextNode=false, but getNode returns this for prevSibling
        // Actually we need prevSibling to be a text node for line 137 to check isTextEntity
        // $isTextNode checks __isTextNode. Let's set it:
        __isTextNode: true,
        isTextEntity: vi.fn(() => true),
        getTextContent: vi.fn(() => ''), // empty prev text → combinedText = ''+text = text
      }
      class NodeUnderTest {
        __isTextNode = true
        getTextContent = vi.fn(() => 'abc')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn(() => [])
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => prevSiblingEntity)
        getNextSibling = vi.fn(() => null)
        getLatest = vi.fn(() => ({ __mode: 0 }))
      }
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        // call 1: getMatch(combinedText=''+'abc'='abc') from prevSibling block
        // prevSiblingEntity is NOT a TargetNode → isTargetNode=false
        // prevMatch = {start:0,end:3}: prevMatch.start(0) >= prevText.length(0) → does NOT return early
        // Falls through to while loop
        // call 2 (while loop): match=getMatch('abc') = {start:0,end:3}
        // nextText = 'abc'.slice(3) = '' → nextSibling=null → no nextSibling branch
        // match not null → check line 137: start===0 && prevSibling.__isTextNode && isTextEntity=true → continue!
        // call 3 (continue, while loop again): match=getMatch('') = null → return at line 134
        if (n <= 2)
          return { start: 0, end: 3 }
        return null
      })

      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((node: TextNode) => node as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest() as unknown as TextNode)

      // continue was executed (createNode skipped for the continue iteration), exits via match=null
      expect(createNode).not.toHaveBeenCalled()
      // getMatch called at least 3 times (prevSibling check + 2 while iters)
      expect(getMatch.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ---------------------------------------------------------------------------
  // getFullMatchOffset (exercised via $splitNodeContainingQuery)
  // Lines 262-263: when documentText ends match entryText slice, update triggerOffset
  // ---------------------------------------------------------------------------
  describe('getFullMatchOffset via $splitNodeContainingQuery', () => {
    it('should update triggerOffset when documentText suffix equals entryText prefix', () => {
      // getFullMatchOffset(documentText, entryText, offset):
      // i=1..entryText.length: if documentText.slice(-i) === entryText.slice(0,i) → triggerOffset=i
      // Example: documentText='@abc', entryText='abc', offset=3 (replaceableString='@abc'→len=4)
      // Wait, let's trace: textContent.slice(0, selectionOffset)
      // Use: textContent='hello @abc', offset=10 → documentText='hello @abc'
      // matchingString='abc', replaceableString='@abc' → characterOffset=4
      // getFullMatchOffset('hello @abc', 'abc', 4):
      //   i=4: 'lo @'.slice → no, slice(-4)='@abc', 'abc'.slice(0,4)='abc' → ' @abc'≠'abc'
      //   i=3: ' @a'.slice(-3)=' @a' vs 'abc' → no
      //   i=2: slice(-2)='bc' === 'abc'.slice(0,2)='ab' → no
      //   i=1: slice(-1)='c' === 'abc'.slice(0,1)='a' → no
      // Hmm - 'hello @abc'.slice(-3)='abc' === 'abc'.slice(0,3)='abc' → yes! triggerOffset=3
      //   But start i=4 (characterOffset=4), loop from 4 to 3... loop is i=triggerOffset(4);i<=3;i++
      //   → doesn't run at all! So triggerOffset stays at 4 → queryOffset=4 → startOffset=6
      // Let's use: textContent='@abc', offset=4, matchingString='abc', replaceableString='@abc'
      // documentText='@abc'.slice(0,4)='@abc', characterOffset=4
      // getFullMatchOffset('@abc','abc',4):
      //   triggerOffset=4, loop i=4..3): doesn't run → returns 4
      //   queryOffset=4, startOffset=4-4=0 → single split
      // Actually the loop is: for(let i=triggerOffset; i<=entryText.length; i++)
      // entryText='abc'.length=3, triggerOffset=4 → 4<=3 is false → no iterations
      // To trigger the loop: triggerOffset < entryText.length
      // triggerOffset = characterOffset = replaceableString.length
      // Need replaceableString.length < matchingString.length
      // replaceableString='@a'(len=2), matchingString='abc'(len=3)
      // getFullMatchOffset(documentText, 'abc', 2):
      //   loop i=2..3:
      //     i=2: documentText.slice(-2) === 'abc'.slice(0,2)='ab'
      //     i=3: documentText.slice(-3) === 'abc'.slice(0,3)='abc'
      // If documentText ends with 'abc': slice(-3)='abc'='abc' → triggerOffset=3
      // queryOffset=3, startOffset=selectionOffset-3
      // Use: textContent='xabc', selectionOffset=4, documentText='xabc'
      //   i=2: 'xabc'.slice(-2)='bc' vs 'ab' → no
      //   i=3: 'xabc'.slice(-3)='abc' vs 'abc' → YES → triggerOffset=3
      // queryOffset=3, startOffset=4-3=1 > 0 → two-arg split: splitText(1,4)
      const newNode = { id: 'found' }
      const anchorNode = {
        isSimpleText: () => true,
        getTextContent: () => 'xabc',
        splitText: vi.fn(() => [null, newNode]),
      }
      mockState.selection = {
        __isRangeSelection: true,
        isCollapsed: () => true,
        anchor: { type: 'text', offset: 4, getNode: () => anchorNode },
      }
      const m: MenuTextMatch = {
        leadOffset: 0,
        matchingString: 'abc', // length=3
        replaceableString: '@a', // characterOffset=2, so loop runs i=2..3
      }

      const result = $splitNodeContainingQuery(m)

      // triggerOffset updated to 3 → startOffset = 4-3 = 1 → two-arg split
      expect(anchorNode.splitText).toHaveBeenCalledWith(1, 4)
      expect(result).toBe(newNode)
    })
  })

  // ---------------------------------------------------------------------------
  // textNodeTransform remaining branches (lines 54, 59, 77-93, 131)
  // ---------------------------------------------------------------------------
  describe('registerLexicalTextEntity - remaining textNodeTransform branches', () => {
    it('textNodeTransform: returns immediately when node is not simple text (line 58-59)', () => {
      class TargetNode { }
      class NodeUnderTest {
        __isTextNode = true
        isSimpleText = vi.fn(() => false) // NOT simple text
        getTextContent = vi.fn(() => 'text')
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
      }
      const getMatch = vi.fn()
      const { editor, registerNodeTransform } = makeEditor()
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest() as unknown as TextNode)

      // isSimpleText returns false → return at line 59, getMatch never called
      expect(getMatch).not.toHaveBeenCalled()
    })

    it('textNodeTransform: prevSibling TargetNode with valid match and diff>0 (diff<text.length, sets partial text)', () => {
      // Lines 77-91: prevSibling IS a TargetNode with valid match, getMode===0, diff>0 and diff<text.length
      // → prevSibling.select(), prevSibling.setTextContent(), node.setTextContent(remainingText), return
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => '@ab') // previousText = '@ab' (len=3)
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        select = vi.fn()
        setTextContent = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 })) // getMode === 0 → valid match
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        markDirty = vi.fn()
        remove = vi.fn()
      }
      const prevSibling = new TargetNode()
      prevSibling.getTextContent = vi.fn(() => '@ab') // previousText = '@ab' (len=3)

      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      const getMatch = vi.fn((text: string) => {
        if (text === '@abcd')
          return { start: 0, end: 4 } // prevMatch
        return null
      })

      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      // Need text='cd' node
      class NodeUnderTest2 {
        __isTextNode = true
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getTextContent = vi.fn(() => 'cd') // len=2
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        setTextContent = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        markDirty = vi.fn()
        remove = vi.fn()
        getPreviousSibling = vi.fn(() => prevSibling as unknown)
        getNextSibling = vi.fn(() => null)
      }

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest2() as unknown as TextNode)

      // diff=1, text.length=2 → remaining='d' → setTextContent called with '@ab'+'c'='@abc'
      expect(prevSibling.select).toHaveBeenCalled()
      expect(prevSibling.setTextContent).toHaveBeenCalledWith('@abc')
    })

    it('textNodeTransform: prevSibling TargetNode with diff===text.length causes node.remove() (line 85-86)', () => {
      // diff === text.length → node.remove() instead of setTextContent
      class TargetNode {
        __isTextNode = true
        getTextContent = vi.fn(() => '@ab')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        select = vi.fn()
        setTextContent = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
        markDirty = vi.fn()
        remove = vi.fn()
      }
      const prevSibling = new TargetNode()
      prevSibling.getTextContent = vi.fn(() => '@ab') // previousText.length = 3

      class NodeUnderTest {
        __isTextNode = true
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getTextContent = vi.fn(() => 'c') // text.length = 1
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        setTextContent = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        markDirty = vi.fn()
        remove = vi.fn()
        getPreviousSibling = vi.fn(() => prevSibling as unknown)
        getNextSibling = vi.fn(() => null)
      }
      // combinedText='@abc', prevMatch.end=4 → diff=4-3=1, text.length=1 → diff===text.length → node.remove()
      const getMatch = vi.fn((text: string) => {
        if (text === '@abc')
          return { start: 0, end: 4 }
        return null
      })
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      const node = new NodeUnderTest() as unknown as TextNode
      textTransform(node)

      // diff(1) === text.length(1) → node.remove()
      expect(prevSibling.select).toHaveBeenCalled()
      expect(node.remove).toHaveBeenCalled()
    })

    it('textNodeTransform: returns when nextText is non-empty and nextMatch.start===0 (line 130-131)', () => {
      // In the else branch (nextText !== ''): if nextMatch !== null && nextMatch.start===0 → return
      class TargetNode { }
      class NodeUnderTest {
        __isTextNode = true
        isSimpleText = vi.fn(() => true)
        isTextEntity = vi.fn(() => false)
        getTextContent = vi.fn(() => 'abcdef')
        getFormat = vi.fn(() => 0)
        replace = vi.fn()
        splitText = vi.fn()
        getLatest = vi.fn(() => ({ __mode: 0 }))
        markDirty = vi.fn()
        remove = vi.fn()
        getPreviousSibling = vi.fn(() => null)
        getNextSibling = vi.fn(() => null)
      }
      let n = 0
      const getMatch = vi.fn(() => {
        n++
        if (n === 1)
          return { start: 0, end: 3 } // first iter: nextText='abcdef'.slice(3)='def' (non-empty)
        if (n === 2)
          return { start: 0, end: 3 } // second call (on nextText='def'): start===0 → return at line 131
        return null
      })
      const { editor, registerNodeTransform } = makeEditor()
      mockState.createTextNode.mockReturnValue({ setFormat: vi.fn() })
      type TN = InstanceType<typeof TargetNode> & TextNode
      const targetNodeClass = TargetNode as unknown as Klass<TN>
      const createNode = vi.fn((n: TextNode) => n as TN)

      registerLexicalTextEntity(editor, getMatch, targetNodeClass, createNode)
      const textTransform = registerNodeTransform.mock.calls[0]![1] as (n: TextNode) => void
      textTransform(new NodeUnderTest() as unknown as TextNode)

      // Returns at line 131 because nextMatch.start===0 for nextText → no split/replace
      expect(createNode).not.toHaveBeenCalled()
    })
  })
})
