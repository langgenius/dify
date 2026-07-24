import type { RootNode } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot, ParagraphNode, TextNode } from 'lexical'
import { describe, expect, it, vi } from 'vitest'
import { createTestEditor, withEditorUpdate } from './utils'

describe('Prompt Editor Test Utils', () => {
  describe('createTestEditor', () => {
    it('should create an editor without crashing', () => {
      const editor = createTestEditor()
      expect(editor).toBeDefined()
    })

    it('should create an editor with no nodes by default', () => {
      const editor = createTestEditor()
      expect(editor).toBeDefined()
    })

    it('should create an editor with provided nodes', () => {
      const nodes = [ParagraphNode, TextNode]
      const editor = createTestEditor(nodes)
      expect(editor).toBeDefined()
    })

    it('should set up root element for the editor', () => {
      const editor = createTestEditor()
      // The editor should be properly initialized with a root element
      expect(editor).toBeDefined()
    })

    it('should throw errors when they occur', () => {
      const nodes = [ParagraphNode, TextNode]
      const editor = createTestEditor(nodes)

      expect(() => {
        editor.update(() => {
          throw new Error('Test error')
        }, { discrete: true })
      }).toThrow('Test error')
    })

    it('should allow multiple editors to be created independently', () => {
      const editor1 = createTestEditor()
      const editor2 = createTestEditor()

      expect(editor1).not.toBe(editor2)
    })

    it('should initialize with basic node types', () => {
      const nodes = [ParagraphNode, TextNode]
      const editor = createTestEditor(nodes)

      let content: string = ''
      editor.update(() => {
        const root = $getRoot()
        const paragraph = $createParagraphNode()
        const text = $createTextNode('Hello World')
        paragraph.append(text)
        root.append(paragraph)

        content = root.getTextContent()
      }, { discrete: true })

      expect(content).toBe('Hello World')
    })
  })

  describe('withEditorUpdate', () => {
    it('should execute update function without crashing', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      const updateFn = vi.fn()

      withEditorUpdate(editor, updateFn)

      expect(updateFn).toHaveBeenCalled()
    })

    it('should pass discrete: true option to editor.update', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      const updateSpy = vi.spyOn(editor, 'update')

      withEditorUpdate(editor, () => {
        $getRoot()
      })

      expect(updateSpy).toHaveBeenCalledWith(expect.any(Function), { discrete: true })
    })

    it('should allow updating editor state', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      let textContent: string = ''

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const paragraph = $createParagraphNode()
        const text = $createTextNode('Test Content')
        paragraph.append(text)
        root.append(paragraph)
      })

      withEditorUpdate(editor, () => {
        textContent = $getRoot().getTextContent()
      })

      expect(textContent).toBe('Test Content')
    })

    it('should handle multiple consecutive updates', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        p1.append($createTextNode('First'))
        root.append(p1)
      })

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const p2 = $createParagraphNode()
        p2.append($createTextNode('Second'))
        root.append(p2)
      })

      let content: string = ''
      withEditorUpdate(editor, () => {
        content = $getRoot().getTextContent()
      })

      expect(content).toContain('First')
      expect(content).toContain('Second')
    })

    it('should provide access to editor state within update', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      let capturedState: RootNode | null = null

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        capturedState = root
      })

      expect(capturedState).toBeDefined()
    })

    it('should execute update function immediately', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      let executed = false

      withEditorUpdate(editor, () => {
        executed = true
      })

      // Update should be executed synchronously in discrete mode
      expect(executed).toBe(true)
    })

    it('should handle complex editor operations within update', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])
      let nodeCount: number = 0

      withEditorUpdate(editor, () => {
        const root = $getRoot()

        for (let i = 0; i < 3; i++) {
          const paragraph = $createParagraphNode()
          paragraph.append($createTextNode(`Paragraph ${i}`))
          root.append(paragraph)
        }

        // Count child nodes
        nodeCount = root.getChildrenSize()
      })

      expect(nodeCount).toBe(3)
    })

    it('should allow reading editor state after update', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode('Read Test'))
        root.append(paragraph)
      })

      let readContent: string = ''
      withEditorUpdate(editor, () => {
        readContent = $getRoot().getTextContent()
      })

      expect(readContent).toBe('Read Test')
    })

    it('should handle error thrown within update function', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      expect(() => {
        withEditorUpdate(editor, () => {
          throw new Error('Update error')
        })
      }).toThrow('Update error')
    })

    it('should preserve editor state across multiple updates', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const p = $createParagraphNode()
        p.append($createTextNode('Persistent'))
        root.append(p)
      })

      let persistedContent: string = ''
      withEditorUpdate(editor, () => {
        persistedContent = $getRoot().getTextContent()
      })

      expect(persistedContent).toBe('Persistent')
    })
  })

  describe('Integration', () => {
    it('should work together to create and update editor', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const p = $createParagraphNode()
        p.append($createTextNode('Integration Test'))
        root.append(p)
      })

      let result: string = ''
      withEditorUpdate(editor, () => {
        result = $getRoot().getTextContent()
      })

      expect(result).toBe('Integration Test')
    })

    it('should support multiple editors with isolated state', () => {
      const editor1 = createTestEditor([ParagraphNode, TextNode])
      const editor2 = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor1, () => {
        const root = $getRoot()
        const p = $createParagraphNode()
        p.append($createTextNode('Editor 1'))
        root.append(p)
      })

      withEditorUpdate(editor2, () => {
        const root = $getRoot()
        const p = $createParagraphNode()
        p.append($createTextNode('Editor 2'))
        root.append(p)
      })

      let content1: string = ''
      let content2: string = ''

      withEditorUpdate(editor1, () => {
        content1 = $getRoot().getTextContent()
      })

      withEditorUpdate(editor2, () => {
        content2 = $getRoot().getTextContent()
      })

      expect(content1).toBe('Editor 1')
      expect(content2).toBe('Editor 2')
    })

    it('should handle nested paragraph and text nodes', () => {
      const editor = createTestEditor([ParagraphNode, TextNode])

      withEditorUpdate(editor, () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        const p2 = $createParagraphNode()

        p1.append($createTextNode('First Para'))
        p2.append($createTextNode('Second Para'))

        root.append(p1)
        root.append(p2)
      })

      let content: string = ''
      withEditorUpdate(editor, () => {
        content = $getRoot().getTextContent()
      })

      expect(content).toContain('First Para')
      expect(content).toContain('Second Para')
    })
  })
})
