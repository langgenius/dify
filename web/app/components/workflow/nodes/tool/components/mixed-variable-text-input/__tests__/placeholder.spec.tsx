import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $getRoot } from 'lexical'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import Placeholder from '../placeholder'

function renderPlaceholder(disableVariableInsertion = false) {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: 'tool-placeholder-test',
        nodes: [CustomTextNode],
        onError: (error) => {
          throw error
        },
        editorState: () => {
          const paragraph = $createParagraphNode()
          $getRoot().append(paragraph)
          paragraph.select()
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label="Tool input" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <Placeholder disableVariableInsertion={disableVariableInsertion} />
    </LexicalComposer>,
  )
}

describe('tool text placeholder', () => {
  it('inserts the variable trigger into the real editor', async () => {
    const user = userEvent.setup()
    renderPlaceholder()

    await user.click(screen.getByText('workflow.nodes.tool.insertPlaceholder2'))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Tool input' })).toHaveTextContent('/'),
    )
  })

  it('omits variable insertion when only literal text is allowed', () => {
    renderPlaceholder(true)

    expect(screen.getByText('workflow.nodes.tool.insertPlaceholder1')).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.insertPlaceholder2')).not.toBeInTheDocument()
  })
})
