import type { LexicalEditor } from 'lexical'
import type { ReactNode } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render } from '@testing-library/react'
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical'
import * as React from 'react'
import { ContextBlockNode } from '../context-block/node'
import { $createCustomTextNode, CustomTextNode } from '../custom-text/node'
import ContextBlockReplacementBlock from './context-block-replacement-block'

// Mock the component rendered by ContextBlockNode.decorate()
vi.mock('./component', () => ({
  default: () => null,
}))

function createEditorConfig() {
  return {
    namespace: 'test',
    nodes: [CustomTextNode, ContextBlockNode],
    onError: (error: Error) => { throw error },
  }
}

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <LexicalComposer initialConfig={createEditorConfig()}>
      {children}
    </LexicalComposer>
  )
}

function renderWithEditor(ui: ReactNode) {
  return render(ui, { wrapper: TestWrapper })
}

// Captures the editor instance so we can do updates after the initial render
let capturedEditor: LexicalEditor | null = null

const defaultOnCapture = (editor: LexicalEditor) => {
  capturedEditor = editor
}

function EditorCapture({ onCapture = defaultOnCapture }: { onCapture?: (e: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  React.useEffect(() => {
    onCapture(editor)
  }, [editor, onCapture])
  return null
}

type ReadResult = {
  count: number
  datasets: Array<{ id: string, name: string, type: string }>
  canNotAddContext: boolean
}

function insertTextAndRead(text: string): ReadResult {
  if (!capturedEditor)
    throw new Error('Editor not captured')

  // Insert CustomTextNode with the given text
  capturedEditor.update(() => {
    const root = $getRoot()
    root.clear()
    const paragraph = $createParagraphNode()
    const textNode = $createCustomTextNode(text)
    paragraph.append(textNode)
    root.append(paragraph)
  }, { discrete: true })

  // Read the resulting state — extract all properties inside .read()
  const result: ReadResult = { count: 0, datasets: [], canNotAddContext: false }
  capturedEditor.getEditorState().read(() => {
    const nodes = $nodesOfType(ContextBlockNode)
    result.count = nodes.length
    if (nodes.length > 0) {
      result.datasets = nodes[0].getDatasets()
      result.canNotAddContext = nodes[0].getCanNotAddContext()
    }
  })
  return result
}

describe('ContextBlockReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedEditor = null
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )
      expect(capturedEditor).not.toBeNull()
    })

    it('should return null (no visible output from the plugin itself)', () => {
      const { container } = renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )
      expect(container.querySelector('[data-testid]')).toBeNull()
    })
  })

  describe('Editor Node Registration Check', () => {
    it('should not throw when ContextBlockNode is registered', () => {
      expect(() => {
        renderWithEditor(
          <>
            <ContextBlockReplacementBlock />
            <EditorCapture />
          </>,
        )
      }).not.toThrow()
    })

    it('should throw when ContextBlockNode is not registered', () => {
      const configWithoutNode = {
        namespace: 'test',
        nodes: [CustomTextNode],
        onError: (error: Error) => { throw error },
      }

      expect(() => {
        render(
          <LexicalComposer initialConfig={configWithoutNode}>
            <ContextBlockReplacementBlock />
          </LexicalComposer>,
        )
      }).toThrow('ContextBlockNodePlugin: ContextBlockNode not registered on editor')
    })
  })

  describe('Text Replacement Transform', () => {
    it('should replace context placeholder text with a ContextBlockNode', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#context#}}')
      expect(result.count).toBe(1)
    })

    it('should not replace text that is not the placeholder', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('just some normal text')
      expect(result.count).toBe(0)
    })

    it('should not replace partial placeholder text', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#contex')
      expect(result.count).toBe(0)
    })

    it('should pass datasets to the created ContextBlockNode', () => {
      const datasets = [{ id: '1', name: 'Test', type: 'text' }]
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock datasets={datasets} onAddContext={vi.fn()} />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#context#}}')
      expect(result.count).toBe(1)
      expect(result.datasets).toEqual(datasets)
    })

    it('should pass canNotAddContext to the created ContextBlockNode', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock canNotAddContext={true} />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#context#}}')
      expect(result.count).toBe(1)
      expect(result.canNotAddContext).toBe(true)
    })
  })

  describe('onInsert callback', () => {
    it('should call onInsert when a placeholder is replaced', () => {
      const onInsert = vi.fn()
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock onInsert={onInsert} />
          <EditorCapture />
        </>,
      )

      insertTextAndRead('{{#context#}}')
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not call onInsert when no placeholder is found', () => {
      const onInsert = vi.fn()
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock onInsert={onInsert} />
          <EditorCapture />
        </>,
      )

      insertTextAndRead('no placeholder here')
      expect(onInsert).not.toHaveBeenCalled()
    })
  })

  describe('Props Defaults', () => {
    it('should default datasets to empty array', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#context#}}')
      expect(result.datasets).toEqual([])
    })

    it('should default canNotAddContext to false', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('{{#context#}}')
      expect(result.canNotAddContext).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined datasets prop', () => {
      expect(() => {
        renderWithEditor(
          <>
            <ContextBlockReplacementBlock datasets={undefined} />
            <EditorCapture />
          </>,
        )
      }).not.toThrow()
    })

    it('should handle empty datasets array', () => {
      expect(() => {
        renderWithEditor(
          <>
            <ContextBlockReplacementBlock datasets={[]} />
            <EditorCapture />
          </>,
        )
      }).not.toThrow()
    })

    it('should handle empty string text', () => {
      renderWithEditor(
        <>
          <ContextBlockReplacementBlock />
          <EditorCapture />
        </>,
      )

      const result = insertTextAndRead('')
      expect(result.count).toBe(0)
    })
  })
})
