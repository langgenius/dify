import type { LexicalEditor } from 'lexical'
import { act, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  ParagraphNode,
  TextNode,
} from 'lexical'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
  getNodeCount,
  getNodesByType,
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'

describe('test-helpers', () => {
  describe('renderLexicalEditor & waitForEditorReady', () => {
    it('should render the editor and wait for it', async () => {
      const { getEditor } = renderLexicalEditor({
        namespace: 'TestNamespace',
        nodes: [ParagraphNode, TextNode],
        children: null,
      })

      const editor = await waitForEditorReady(getEditor)
      expect(editor).toBeDefined()
      expect(editor).toBe(getEditor())
    })

    it('should throw if wait times out without editor', async () => {
      await expect(waitForEditorReady(() => null)).rejects.toThrow()
    })

    it('should throw if editor is null after waitFor completes', async () => {
      let callCount = 0
      await expect(
        waitForEditorReady(() => {
          callCount++
          // Return non-null on the last check of `waitFor` so it passes,
          // then null when actually retrieving the editor
          return callCount === 1 ? ({} as LexicalEditor) : null
        }),
      ).rejects.toThrow('Editor is not available')
    })

    it('should surface errors through configured onError callback', async () => {
      const { getEditor } = renderLexicalEditor({
        namespace: 'TestNamespace',
        nodes: [ParagraphNode, TextNode],
        children: null,
      })
      const editor = await waitForEditorReady(getEditor)

      expect(() => {
        editor.update(() => {
          throw new Error('test error')
        }, { discrete: true })
      }).toThrow('test error')
    })
  })

  describe('selectRootEnd', () => {
    it('should select the end of the root', async () => {
      const { getEditor } = renderLexicalEditor({ namespace: 'test', nodes: [ParagraphNode, TextNode], children: null })
      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      await waitFor(() => {
        let isRangeSelection = false
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          isRangeSelection = $isRangeSelection(selection)
        })
        expect(isRangeSelection).toBe(true)
      })
    })
  })

  describe('Content Reading/Writing Helpers', () => {
    it('should read root text content', async () => {
      const { getEditor } = renderLexicalEditor({ namespace: 'test', nodes: [ParagraphNode, TextNode], children: null })
      const editor = await waitForEditorReady(getEditor)

      act(() => {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          paragraph.append($createTextNode('Hello World'))
          root.append(paragraph)
        }, { discrete: true })
      })

      let content = ''
      act(() => {
        content = readRootTextContent(editor)
      })
      expect(content).toBe('Hello World')
    })

    it('should set editor root text and select end', async () => {
      const { getEditor } = renderLexicalEditor({ namespace: 'test', nodes: [ParagraphNode, TextNode], children: null })
      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'New Text', $createTextNode)

      await waitFor(() => {
        let content = ''
        editor.getEditorState().read(() => {
          content = $getRoot().getTextContent()
        })
        expect(content).toBe('New Text')
      })
    })
  })

  describe('Node Selection Helpers', () => {
    it('should get node count', async () => {
      const { getEditor } = renderLexicalEditor({ namespace: 'test', nodes: [ParagraphNode, TextNode], children: null })
      const editor = await waitForEditorReady(getEditor)

      act(() => {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          root.append($createParagraphNode())
          root.append($createParagraphNode())
        }, { discrete: true })
      })

      let count = 0
      act(() => {
        count = getNodeCount(editor, ParagraphNode)
      })
      expect(count).toBe(2)
    })

    it('should get nodes by type', async () => {
      const { getEditor } = renderLexicalEditor({ namespace: 'test', nodes: [ParagraphNode, TextNode], children: null })
      const editor = await waitForEditorReady(getEditor)

      act(() => {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          root.append($createParagraphNode())
        }, { discrete: true })
      })

      let nodes: ParagraphNode[] = []
      act(() => {
        nodes = getNodesByType(editor, ParagraphNode)
      })
      expect(nodes).toHaveLength(1)
      expect(nodes[0]).not.toBeUndefined()
    })
  })

  describe('readEditorStateValue', () => {
    it('should read primitive values from editor state', () => {
      const editor = createLexicalTestEditor('test', [ParagraphNode, TextNode])

      const val = readEditorStateValue(editor, () => {
        return $getRoot().isEmpty()
      })
      expect(val).toBe(true)
    })

    it('should throw if value is undefined', () => {
      const editor = createLexicalTestEditor('test', [ParagraphNode, TextNode])

      expect(() => {
        readEditorStateValue(editor, () => undefined)
      }).toThrow('Failed to read editor state value')
    })
  })

  describe('createLexicalTestEditor', () => {
    it('should expose createLexicalTestEditor with onError throw', () => {
      const editor = createLexicalTestEditor('custom-namespace', [ParagraphNode, TextNode])
      expect(editor).toBeDefined()

      expect(() => {
        editor.update(() => {
          throw new Error('test error')
        }, { discrete: true })
      }).toThrow('test error')
    })
  })

  describe('expectInlineWrapperDom', () => {
    it('should assert wrapper properties on a valid DOM element', () => {
      const div = document.createElement('div')
      div.classList.add('inline-flex', 'items-center', 'align-middle', 'extra1', 'extra2')

      expectInlineWrapperDom(div, ['extra1', 'extra2']) // Does not throw
    })
  })
})
