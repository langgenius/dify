import type { LexicalEditor } from 'lexical'
import type { ReactNode } from 'react'
import type { Dataset } from './index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render } from '@testing-library/react'
import { $createParagraphNode, $getRoot } from 'lexical'
import * as React from 'react'
import { ContextBlock, DELETE_CONTEXT_BLOCK_COMMAND, INSERT_CONTEXT_BLOCK_COMMAND } from './index'
import { ContextBlockNode } from './node'

const mockCreateContextBlockNode = vi.fn()

vi.mock('./node', async () => {
  const actual = await vi.importActual<typeof import('./node')>('./node')

  return {
    ...actual,
    $createContextBlockNode: (datasets: Dataset[], onAddContext: () => void, canNotAddContext?: boolean) => {
      mockCreateContextBlockNode(datasets, onAddContext, canNotAddContext)
      return actual.$createContextBlockNode(datasets, onAddContext, canNotAddContext)
    },
  }
})

vi.mock('./component', () => ({
  default: () => null,
}))

type EditorConfig = {
  namespace: string
  nodes: [typeof ContextBlockNode] | []
  onError: (error: Error) => void
}

function createEditorConfig(includeContextBlockNode = true): EditorConfig {
  return {
    namespace: 'test',
    nodes: includeContextBlockNode ? [ContextBlockNode] : [],
    onError: (error: Error) => { throw error },
  }
}

let capturedEditor: LexicalEditor | null = null

function EditorCapture() {
  const [editor] = useLexicalComposerContext()
  React.useEffect(() => {
    capturedEditor = editor
  }, [editor])
  return null
}

function renderWithEditor(ui: ReactNode, includeContextBlockNode = true) {
  return render(
    <LexicalComposer initialConfig={createEditorConfig(includeContextBlockNode)}>
      {ui}
      <EditorCapture />
    </LexicalComposer>,
  )
}

function setupParagraphSelection() {
  if (!capturedEditor)
    throw new Error('Editor not captured')

  capturedEditor.update(() => {
    const root = $getRoot()
    root.clear()
    const paragraph = $createParagraphNode()
    root.append(paragraph)
    paragraph.select()
  }, { discrete: true })
}

function dispatchInsert() {
  if (!capturedEditor)
    throw new Error('Editor not captured')

  setupParagraphSelection()
  return capturedEditor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
}

function dispatchDelete() {
  if (!capturedEditor)
    throw new Error('Editor not captured')

  return capturedEditor.dispatchCommand(DELETE_CONTEXT_BLOCK_COMMAND, undefined)
}

describe('ContextBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedEditor = null
  })

  describe('Rendering', () => {
    it('should render (no visible output)', () => {
      const { container } = renderWithEditor(<ContextBlock />)
      expect(container.childElementCount).toBe(0)
    })
  })

  describe('Editor Node Registration Check', () => {
    it('should not throw when ContextBlockNode is registered', () => {
      expect(() => {
        renderWithEditor(<ContextBlock />)
      }).not.toThrow()
    })

    it('should throw when ContextBlockNode is not registered', () => {
      expect(() => {
        renderWithEditor(<ContextBlock />, false)
      }).toThrow('ContextBlockPlugin: ContextBlock not registered on editor')
    })
  })

  describe('INSERT_CONTEXT_BLOCK_COMMAND handler', () => {
    it('should insert a context block node with default props', () => {
      renderWithEditor(<ContextBlock />)

      const handled = dispatchInsert()

      expect(handled).toBe(true)
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith([], expect.any(Function), undefined)
    })

    it('should call onInsert when provided', () => {
      const onInsert = vi.fn()
      renderWithEditor(<ContextBlock onInsert={onInsert} />)

      dispatchInsert()

      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should pass datasets to the created node', () => {
      const datasets: Dataset[] = [{ id: '1', name: 'Test', type: 'text' }]
      renderWithEditor(<ContextBlock datasets={datasets} />)

      dispatchInsert()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith(datasets, expect.any(Function), undefined)
    })

    it('should pass canNotAddContext to the created node', () => {
      renderWithEditor(<ContextBlock canNotAddContext={true} />)

      dispatchInsert()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function),
        true,
      )
    })
  })

  describe('DELETE_CONTEXT_BLOCK_COMMAND handler', () => {
    it('should return true when dispatched', () => {
      renderWithEditor(<ContextBlock />)

      const handled = dispatchDelete()

      expect(handled).toBe(true)
    })

    it('should call onDelete when provided', () => {
      const onDelete = vi.fn()
      renderWithEditor(<ContextBlock onDelete={onDelete} />)

      dispatchDelete()

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onDelete is not provided', () => {
      renderWithEditor(<ContextBlock />)

      expect(() => dispatchDelete()).not.toThrow()
    })
  })

  describe('Props Defaults', () => {
    it('should default onAddContext to a noop function', () => {
      renderWithEditor(<ContextBlock />)

      dispatchInsert()
      const onAddContextArg = mockCreateContextBlockNode.mock.calls[0][1] as () => void

      expect(typeof onAddContextArg).toBe('function')
      expect(() => onAddContextArg()).not.toThrow()
    })
  })

  describe('Lifecycle', () => {
    it('should unregister commands on unmount', () => {
      const onDelete = vi.fn()
      const { unmount } = renderWithEditor(<ContextBlock onDelete={onDelete} />)

      unmount()
      const handledAfterUnmount = dispatchDelete()

      expect(handledAfterUnmount).toBe(false)
      expect(onDelete).not.toHaveBeenCalled()
    })
  })

  describe('Exports', () => {
    it('should export INSERT_CONTEXT_BLOCK_COMMAND', () => {
      expect(INSERT_CONTEXT_BLOCK_COMMAND).toBeDefined()
    })

    it('should export DELETE_CONTEXT_BLOCK_COMMAND', () => {
      expect(DELETE_CONTEXT_BLOCK_COMMAND).toBeDefined()
    })

    it('should export ContextBlock component', () => {
      expect(ContextBlock).toBeDefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined datasets prop', () => {
      renderWithEditor(<ContextBlock datasets={undefined} />)

      dispatchInsert()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith([], expect.any(Function), undefined)
    })

    it('should handle empty datasets array', () => {
      renderWithEditor(<ContextBlock datasets={[]} />)

      dispatchInsert()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith([], expect.any(Function), undefined)
    })
  })
})
