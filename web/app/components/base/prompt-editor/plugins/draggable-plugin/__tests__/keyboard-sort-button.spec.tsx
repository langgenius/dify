import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createHITLInputNode, HITLInputNode } from '../../hitl-input-block/node'

// Input configuration does not own block ordering. Keep the real Lexical node,
// decorator component, editor and keyboard sorting control in this integration.
vi.mock('../../hitl-input-block/component-ui', () => ({
  default: () => <input aria-label="Input configuration" />,
}))

function Fixture({
  onSave,
  readonly = false,
}: {
  onSave: (text: string) => void
  readonly?: boolean
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'keyboard-sort-test',
        nodes: [HITLInputNode],
        onError: (error) => {
          throw error
        },
        editorState: () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode('Before')),
            $createParagraphNode().append(
              $createHITLInputNode(
                'answer',
                'node',
                [],
                vi.fn(),
                vi.fn(),
                vi.fn(),
                {},
                undefined,
                undefined,
                undefined,
                undefined,
                readonly,
              ),
            ),
            $createParagraphNode().append($createTextNode('After')),
          )
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label="Prompt" />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(state) => state.read(() => onSave($getRoot().getTextContent()))}
      />
    </LexicalComposer>
  )
}

describe('HITL block keyboard ordering', () => {
  it('previews a bounded position, commits once and preserves surrounding text', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Fixture onSave={onSave} />)
    const handle = await screen.findByRole('button', { name: /sort.handle/ })
    await user.tab()
    await user.tab()
    onSave.mockClear()
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(onSave).not.toHaveBeenCalled()
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveTextContent(/Before.*After/)
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith('Before\n\nAfter\n\n{{#$output.answer#}}'),
    )
    expect(handle).toHaveFocus()
    expect(handle).toHaveAttribute('aria-pressed', 'false')
  })

  it('cancels the preview and leaves text input arrow keys outside the sort interaction', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Fixture onSave={onSave} />)
    const handle = await screen.findByRole('button', { name: /sort.handle/ })
    await user.tab()
    await user.tab()
    onSave.mockClear()
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    await user.keyboard('{ArrowUp}{Escape}')
    expect(onSave).not.toHaveBeenCalled()
    expect(handle).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard(' {ArrowDown}{Tab}')
    expect(handle).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('textbox', { name: 'Input configuration' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Input configuration' }),
      'draft{ArrowUp}{ArrowDown}',
    )
    expect(screen.getByRole('textbox', { name: 'Input configuration' })).toHaveValue('draft')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not offer sorting for read-only input blocks', async () => {
    render(<Fixture onSave={vi.fn()} readonly />)
    await screen.findByRole('textbox', { name: 'Input configuration' })
    expect(screen.queryByRole('button', { name: /sort.handle/ })).not.toBeInTheDocument()
  })
})
