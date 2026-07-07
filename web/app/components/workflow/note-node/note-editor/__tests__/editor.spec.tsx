import type { EditorState, LexicalEditor } from 'lexical'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { $createLinkNode } from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { useEffect } from 'react'
import { NoteEditorContextProvider } from '../context'
import Editor from '../editor'

const emptyValue = JSON.stringify({ root: { children: [] } })
const themeCss = readFileSync(
  resolve(process.cwd(), 'app/components/workflow/note-node/note-editor/theme/theme.css'),
  'utf8',
)

const EditorProbe = ({
  onReady,
}: {
  onReady?: (editor: LexicalEditor) => void
}) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady?.(editor)
  }, [editor, onReady])

  return null
}

const renderEditor = (
  props: Partial<React.ComponentProps<typeof Editor>> = {},
  onEditorReady?: (editor: LexicalEditor) => void,
) => {
  return render(
    <NoteEditorContextProvider value={emptyValue}>
      <>
        <Editor
          containerElement={document.createElement('div')}
          {...props}
        />
        <EditorProbe onReady={onEditorReady} />
      </>
    </NoteEditorContextProvider>,
  )
}

describe('Editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Editor should render the lexical surface with the provided placeholder.
  describe('Rendering', () => {
    it('should render the placeholder text and content editable surface', () => {
      renderEditor({ placeholder: 'Type note' })

      expect(screen.getByText('Type note')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render linked text with distinct link styling', async () => {
      let editor: LexicalEditor | null = null

      renderEditor({}, instance => (editor = instance))

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      act(() => {
        editor!.update(() => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const link = $createLinkNode('https://example.com/docs')
          link.append($createTextNode('Linked docs'))
          paragraph.append(link)
          root.append(paragraph)
        }, { discrete: true })
      })

      const link = await screen.findByRole('link', { name: 'Linked docs' })

      expect(link).toHaveClass('note-editor-theme_link')
      expect(themeCss).toContain('.note-editor-theme_link')
      expect(themeCss).toContain('font-weight: 500;')
      expect(themeCss).toContain('text-decoration: underline;')
    })
  })

  // Focus and blur should toggle workflow shortcuts while editing content.
  describe('Focus Management', () => {
    it('should disable shortcuts on focus and re-enable them on blur-sm', () => {
      const setHistoryShortcutsEnabled = vi.fn()

      renderEditor({ setHistoryShortcutsEnabled })

      const contentEditable = screen.getByRole('textbox')

      fireEvent.focus(contentEditable)
      fireEvent.blur(contentEditable)

      expect(setHistoryShortcutsEnabled).toHaveBeenNthCalledWith(1, false)
      expect(setHistoryShortcutsEnabled).toHaveBeenNthCalledWith(2, true)
    })
  })

  // Lexical change events should be forwarded to the external onChange callback.
  describe('Change Handling', () => {
    it('should pass editor updates through onChange', async () => {
      const changes: string[] = []
      let editor: LexicalEditor | null = null
      const handleChange = (editorState: EditorState) => {
        editorState.read(() => {
          changes.push($getRoot().getTextContent())
        })
      }

      renderEditor({ onChange: handleChange }, instance => (editor = instance))

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      act(() => {
        editor!.update(() => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          paragraph.append($createTextNode('hello'))
          root.append(paragraph)
        }, { discrete: true })
      })

      act(() => {
        editor!.update(() => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          paragraph.append($createTextNode('hello world'))
          root.append(paragraph)
        }, { discrete: true })
      })

      await waitFor(() => {
        expect(changes).toContain('hello world')
      })
    })
  })
})
