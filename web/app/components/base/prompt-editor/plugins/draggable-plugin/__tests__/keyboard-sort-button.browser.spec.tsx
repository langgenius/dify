import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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

describe('HITL sort handle native focus', () => {
  it('reveals the keyboard-only handle on Tab and keeps focus after moving its Lexical block', async () => {
    // Native contenteditable focus traversal, CSS disclosure and DOM reparenting
    // can lose the handle or editor selection even when simulated events pass.
    const onSave = vi.fn()
    await render(
      <>
        <button type="button">Before editor</button>
        <Fixture onSave={onSave} />
      </>,
    )
    await page.getByRole('button', { name: 'Before editor' }).click()
    await userEvent.keyboard('{Tab}{Tab}')
    const handle = page.getByRole('button', { name: /sort.handle/ })
    await expect.element(handle).toHaveFocus()
    expect(handle.element().getBoundingClientRect().width).toBeGreaterThan(1)
    onSave.mockClear()
    await userEvent.keyboard('{Enter}{ArrowDown}')
    expect(onSave).not.toHaveBeenCalled()
    await expect.element(handle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => onSave.mock.calls)
      .toEqual([['Before\n\nAfter\n\n{{#$output.answer#}}']])
    await expect.element(handle).toHaveFocus()
    await expect.element(page.getByRole('status')).toHaveTextContent('sort.finished')
    await userEvent.keyboard(' {ArrowUp}{Escape}')
    await expect.element(handle).toHaveAttribute('aria-pressed', 'false')
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
