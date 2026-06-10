import type { LexicalEditor } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render, screen, waitFor } from '@testing-library/react'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'
import { NoteEditorContextProvider } from '../context'
import { useStore } from '../store'

const emptyValue = JSON.stringify({ root: { children: [] } })
const populatedValue = JSON.stringify({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'hello',
            type: 'text',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
})

const readEditorText = (editor: LexicalEditor) => {
  let text = ''

  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })

  return text
}

const ContextProbe = ({
  onReady,
}: {
  onReady?: (editor: LexicalEditor) => void
}) => {
  const [editor] = useLexicalComposerContext()
  const selectedIsBold = useStore(state => state.selectedIsBold)

  useEffect(() => {
    onReady?.(editor)
  }, [editor, onReady])

  return <div>{selectedIsBold ? 'bold' : 'not-bold'}</div>
}

describe('NoteEditorContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Provider should expose the store and render the wrapped editor tree.
  describe('Rendering', () => {
    it('should render children with the note editor store defaults', async () => {
      let editor: LexicalEditor | null = null

      render(
        <NoteEditorContextProvider value={emptyValue}>
          <ContextProbe onReady={instance => (editor = instance)} />
        </NoteEditorContextProvider>,
      )

      expect(screen.getByText('not-bold')).toBeInTheDocument()

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      expect(editor!.isEditable()).toBe(true)
      expect(readEditorText(editor!)).toBe('')
    })
  })

  // Invalid or empty editor state should fall back to an empty lexical state.
  describe('Editor State Initialization', () => {
    it.each([
      {
        name: 'value is malformed json',
        value: '{invalid',
      },
      {
        name: 'root has no children',
        value: emptyValue,
      },
    ])('should use an empty editor state when $name', async ({ value }) => {
      let editor: LexicalEditor | null = null

      render(
        <NoteEditorContextProvider value={value}>
          <ContextProbe onReady={instance => (editor = instance)} />
        </NoteEditorContextProvider>,
      )

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      expect(readEditorText(editor!)).toBe('')
    })

    it('should restore lexical content and forward editable prop', async () => {
      let editor: LexicalEditor | null = null

      render(
        <NoteEditorContextProvider value={populatedValue} editable={false}>
          <ContextProbe onReady={instance => (editor = instance)} />
        </NoteEditorContextProvider>,
      )

      await waitFor(() => {
        expect(editor).not.toBeNull()
        expect(readEditorText(editor!)).toBe('hello')
      })

      expect(editor!.isEditable()).toBe(false)
    })
  })
})
