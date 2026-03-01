import { $getRoot } from 'lexical'
import { createTestEditor, withEditorUpdate } from '../__tests__/utils'
import { $createContextBlockNode, $isContextBlockNode, ContextBlockNode } from './node'

const mockDatasets = [
  { id: '1', name: 'Dataset A', type: 'text' },
  { id: '2', name: 'Dataset B', type: 'text' },
]
const mockOnAddContext = vi.fn()
const createContextBlockTestEditor = () => createTestEditor([ContextBlockNode])
describe('ContextBlockNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Static Methods', () => {
    it('should return correct type', () => {
      expect(ContextBlockNode.getType()).toBe('context-block')
    })

    it('should clone a node', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, true)
        $getRoot().append(node)
        const cloned = ContextBlockNode.clone(node)
        expect(cloned).toBeInstanceOf(ContextBlockNode)
      })
    })
  })

  describe('Constructor', () => {
    it('should store datasets', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        $getRoot().append(node)
        expect(node.getDatasets()).toEqual(mockDatasets)
      })
    })

    it('should store onAddContext callback', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        $getRoot().append(node)
        expect(node.getOnAddContext()).toBe(mockOnAddContext)
      })
    })

    it('should store canNotAddContext', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, true)
        $getRoot().append(node)
        expect(node.getCanNotAddContext()).toBe(true)
      })
    })

    it('should default canNotAddContext to false', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        $getRoot().append(node)
        expect(node.getCanNotAddContext()).toBe(false)
      })
    })
  })

  describe('isInline', () => {
    it('should return true', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        expect(node.isInline()).toBe(true)
      })
    })
  })

  describe('createDOM', () => {
    it('should create a div element', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        const dom = node.createDOM()
        expect(dom.tagName).toBe('DIV')
      })
    })

    it('should add correct CSS classes', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        const dom = node.createDOM()
        expect(dom.classList.contains('inline-flex')).toBe(true)
        expect(dom.classList.contains('items-center')).toBe(true)
        expect(dom.classList.contains('align-middle')).toBe(true)
      })
    })
  })

  describe('updateDOM', () => {
    it('should return false', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        expect(node.updateDOM()).toBe(false)
      })
    })
  })

  describe('decorate', () => {
    it('should return a React element', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, true)
        $getRoot().append(node)
        const result = node.decorate()
        expect(result).toBeDefined()
        expect(result.props).toEqual(
          expect.objectContaining({
            datasets: mockDatasets,
            onAddContext: mockOnAddContext,
            canNotAddContext: true,
          }),
        )
      })
    })

    it('should pass nodeKey prop', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        $getRoot().append(node)
        const result = node.decorate()
        expect(result.props.nodeKey).toBe(node.getKey())
      })
    })
  })

  describe('getTextContent', () => {
    it('should return the context placeholder', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        expect(node.getTextContent()).toBe('{{#context#}}')
      })
    })
  })

  describe('exportJSON', () => {
    it('should export correct JSON structure', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, true)
        $getRoot().append(node)
        const json = node.exportJSON()
        expect(json.type).toBe('context-block')
        expect(json.version).toBe(1)
        expect(json.datasets).toEqual(mockDatasets)
        expect(json.onAddContext).toBe(mockOnAddContext)
        expect(json.canNotAddContext).toBe(true)
      })
    })
  })

  describe('importJSON', () => {
    it('should create a node from serialized data', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const serialized = {
          type: 'context-block' as const,
          version: 1,
          datasets: mockDatasets,
          onAddContext: mockOnAddContext,
          canNotAddContext: false,
        }
        const node = ContextBlockNode.importJSON(serialized)
        $getRoot().append(node)
        expect(node).toBeInstanceOf(ContextBlockNode)
        expect(node.getDatasets()).toEqual(mockDatasets)
        expect(node.getOnAddContext()).toBe(mockOnAddContext)
        expect(node.getCanNotAddContext()).toBe(false)
      })
    })
  })

  describe('$createContextBlockNode', () => {
    it('should create a ContextBlockNode instance', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        expect(node).toBeInstanceOf(ContextBlockNode)
      })
    })

    it('should pass canNotAddContext when provided', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, true)
        $getRoot().append(node)
        expect(node.getCanNotAddContext()).toBe(true)
      })
    })
  })

  describe('$isContextBlockNode', () => {
    it('should return true for ContextBlockNode instances', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext)
        expect($isContextBlockNode(node)).toBe(true)
      })
    })

    it('should return false for null', () => {
      expect($isContextBlockNode(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect($isContextBlockNode(undefined)).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty datasets', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode([], mockOnAddContext)
        $getRoot().append(node)
        expect(node.getDatasets()).toEqual([])
      })
    })

    it('should handle canNotAddContext as false explicitly', () => {
      const editor = createContextBlockTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createContextBlockNode(mockDatasets, mockOnAddContext, false)
        $getRoot().append(node)
        expect(node.getCanNotAddContext()).toBe(false)
      })
    })
  })
})
