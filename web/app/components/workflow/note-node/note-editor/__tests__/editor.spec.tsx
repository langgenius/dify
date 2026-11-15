import type { EditorState, LexicalEditor } from 'lexical'
import { $createLinkNode } from '@lexical/link'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, screen, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { useEffect } from 'react'
import { NoteEditorContextProvider } from '../context'
import Editor from '../editor'

const emptyValue = JSON.stringify({ root: { children: [] } })

const EditorProbe = ({ onReady }: { onReady?: (editor: LexicalEditor) => void }) => {
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
        <Editor containerElement={document.createElement('div')} {...props} />
        <EditorProbe onReady={onEditorReady} />
      </>
    </NoteEditorContextProvider>,
  )
}

describe('Editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('supports links in the note editor', async () => {
      let editor: LexicalEditor | null = null

      renderEditor({}, (instance) => (editor = instance))

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      act(() => {
        editor!.update(
          () => {
            const root = $getRoot()
            root.clear()
            const paragraph = $createParagraphNode()
            const link = $createLinkNode('https://example.com/docs')
            link.append($createTextNode('Linked docs'))
            paragraph.append(link)
            root.append(paragraph)
          },
          { discrete: true },
        )
      })

      const link = await screen.findByRole('link', { name: 'Linked docs' })

      expect(link).toHaveAttribute('href', 'https://example.com/docs')
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

      renderEditor({ onChange: handleChange }, (instance) => (editor = instance))

      await waitFor(() => {
        expect(editor).not.toBeNull()
      })

      act(() => {
        editor!.update(
          () => {
            const root = $getRoot()
            root.clear()
            const paragraph = $createParagraphNode()
            paragraph.append($createTextNode('hello'))
            root.append(paragraph)
          },
          { discrete: true },
        )
      })

      act(() => {
        editor!.update(
          () => {
            const root = $getRoot()
            root.clear()
            const paragraph = $createParagraphNode()
            paragraph.append($createTextNode('hello world'))
            root.append(paragraph)
          },
          { discrete: true },
        )
      })

      await waitFor(() => {
        expect(changes).toContain('hello world')
        expect(
          screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' }),
        ).toHaveTextContent('hello world')
      })
    })
  })
})
