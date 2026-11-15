import type { LexicalEditor } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $createTextNode, $getRoot, $isTextNode } from 'lexical'
import { TestLexicalComposer } from '@/test/lexical'
import FontSizeSelector from '../font-size-selector'

describe('NoteEditor FontSizeSelector', () => {
  it('applies the chosen size to selected note text and closes the menu', async () => {
    const user = userEvent.setup()
    let editor: LexicalEditor
    function CaptureEditor() {
      ;[editor] = useLexicalComposerContext()
      return null
    }
    render(
      <TestLexicalComposer
        initialConfig={{
          namespace: 'font-size-test',
          onError: (error) => {
            throw error
          },
          editorState: () => {
            const text = $createTextNode('Selected note')
            $getRoot().append($createParagraphNode().append(text))
            text.select(0, text.getTextContentSize())
          },
        }}
      >
        <CaptureEditor />
        <FontSizeSelector />
      </TestLexicalComposer>,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.note.editor.small' }))
    await user.click(await screen.findByText('workflow.nodes.note.editor.large'))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'workflow.nodes.note.editor.large' }),
      ).toBeInTheDocument()
      editor.getEditorState().read(() => {
        const text = $getRoot().getFirstDescendant()
        expect($isTextNode(text) && text.getStyle()).toBe('font-size: 16px;')
      })
    })
    expect(screen.queryByText('workflow.nodes.note.editor.medium')).not.toBeInTheDocument()
  })
})
