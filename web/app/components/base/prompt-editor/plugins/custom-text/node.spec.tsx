import type { EditorConfig } from 'lexical'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { $createCustomTextNode, CustomTextNode } from './node'

function createTestEditor() {
  const editor = createEditor({
    nodes: [CustomTextNode],
    onError: (error) => { throw error },
  })
  const root = document.createElement('div')
  editor.setRootElement(root)
  return editor
}

function withEditorUpdate(editor: ReturnType<typeof createEditor>, fn: () => void) {
  editor.update(fn, { discrete: true })
}

describe('CustomTextNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Static Methods', () => {
    it('should return correct type', () => {
      expect(CustomTextNode.getType()).toBe('custom-text')
    })

    it('should clone a node', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        const node = $createCustomTextNode('hello')
        paragraph.append(node)
        const cloned = CustomTextNode.clone(node)
        expect(cloned).toBeInstanceOf(CustomTextNode)
      })
    })
  })

  describe('createDOM', () => {
    it('should create a DOM element', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('test')
        const config: EditorConfig = { namespace: 'test', theme: {} }
        const dom = node.createDOM(config)
        expect(dom).toBeDefined()
        expect(dom.textContent).toBe('test')
      })
    })
  })

  describe('exportJSON', () => {
    it('should export correct JSON structure', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        const node = $createCustomTextNode('hello world')
        paragraph.append(node)
        const json = node.exportJSON()
        expect(json.type).toBe('custom-text')
        expect(json.version).toBe(1)
        expect(json.text).toBe('hello world')
        expect(json.format).toBeDefined()
        expect(json.detail).toBeDefined()
        expect(json.style).toBeDefined()
      })
    })
  })

  describe('importJSON', () => {
    it('should create a text node from serialized data', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const serialized = {
          type: 'custom-text' as const,
          version: 1,
          text: 'imported text',
          format: 0,
          detail: 0,
          mode: 'normal' as const,
          style: '',
        }
        const node = CustomTextNode.importJSON(serialized)
        expect(node).toBeDefined()
        expect(node.getTextContent()).toBe('imported text')
      })
    })
  })

  describe('isSimpleText', () => {
    it('should return true for custom-text type with mode 0', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('simple')
        expect(node.isSimpleText()).toBe(true)
      })
    })
  })

  describe('getTextContent', () => {
    it('should return the text content', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('my content')
        expect(node.getTextContent()).toBe('my content')
      })
    })
  })

  describe('$createCustomTextNode', () => {
    it('should create a CustomTextNode instance', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('test')
        expect(node).toBeInstanceOf(CustomTextNode)
      })
    })

    it('should set the text content', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('hello')
        expect(node.getTextContent()).toBe('hello')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('')
        expect(node.getTextContent()).toBe('')
      })
    })

    it('should handle special characters', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const node = $createCustomTextNode('{{#context#}}')
        expect(node.getTextContent()).toBe('{{#context#}}')
      })
    })

    it('should handle very long text', () => {
      const editor = createTestEditor()
      withEditorUpdate(editor, () => {
        const longText = 'A'.repeat(10000)
        const node = $createCustomTextNode(longText)
        expect(node.getTextContent()).toBe(longText)
      })
    })
  })
})
